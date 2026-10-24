import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  canAccessActiveAccount,
  canAccessAdmin,
  hasAuthorizationCapability,
  meetsRequiredAal,
  type AuthenticatorAssuranceLevel,
  type AuthorizationCapability,
  type AuthorizationRecord,
} from "@/lib/authz-decision";

export type AuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "AUTHORIZATION_MISSING"
  | "ACCOUNT_INACTIVE"
  | "ADMIN_REQUIRED"
  | "CAPABILITY_REQUIRED"
  | "AAL_REQUIRED";

export class AuthorizationError extends Error {
  constructor(
    public readonly code: AuthorizationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

const verifiedAuthorizationContexts = new WeakSet<object>();

declare const verifiedAuthorizationContextBrand: unique symbol;

export interface AuthorizationContext {
  user: User;
  authorization: AuthorizationRecord;
  aal: AuthenticatorAssuranceLevel | null;
  readonly [verifiedAuthorizationContextBrand]: true;
}

export function assertVerifiedAuthorizationContext(
  context: AuthorizationContext
): void {
  if (!verifiedAuthorizationContexts.has(context)) {
    throw new AuthorizationError(
      "AUTHORIZATION_MISSING",
      "A verified authorization context is required."
    );
  }
}

interface AuthorizationOptions {
  requiredAal?: AuthenticatorAssuranceLevel;
}

interface AuthorizationRow {
  user_id: string;
  role: "member" | "admin";
  status: "active" | "suspended" | "deactivated";
  can_manage_users: boolean;
  can_manage_rewards: boolean;
  can_manage_content: boolean;
  can_manage_financials: boolean;
  can_manage_security: boolean;
}

function toAuthorizationRecord(row: AuthorizationRow): AuthorizationRecord {
  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    canManageUsers: row.can_manage_users,
    canManageRewards: row.can_manage_rewards,
    canManageContent: row.can_manage_content,
    canManageFinancials: row.can_manage_financials,
    canManageSecurity: row.can_manage_security,
  };
}

async function getAuthenticatedAuthorization(
  options: AuthorizationOptions = {}
): Promise<AuthorizationContext> {
  const sessionClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await sessionClient.auth.getUser();

  if (userError || !user) {
    throw new AuthorizationError("UNAUTHENTICATED", "Authentication is required.");
  }

  // The service role is instantiated only after Supabase has verified the session.
  const serviceClient = createServiceClient();
  const { data: row, error: authorizationError } = await serviceClient
    .from("user_authorizations")
    .select(
      "user_id, role, status, can_manage_users, can_manage_rewards, can_manage_content, can_manage_financials, can_manage_security"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (authorizationError) {
    throw new AuthorizationError(
      "AUTHORIZATION_MISSING",
      "Authorization could not be verified."
    );
  }

  const authorization = row
    ? toAuthorizationRecord(row as AuthorizationRow)
    : null;

  if (!authorization) {
    throw new AuthorizationError(
      "AUTHORIZATION_MISSING",
      "No authorization record exists for this account."
    );
  }

  if (!canAccessActiveAccount(authorization)) {
    throw new AuthorizationError(
      "ACCOUNT_INACTIVE",
      "This account is suspended or deactivated."
    );
  }

  const { data: aalData } =
    await sessionClient.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel ?? null) as AuthenticatorAssuranceLevel | null;
  const requiredAal = options.requiredAal ?? "aal1";

  if (!meetsRequiredAal(aal, requiredAal)) {
    throw new AuthorizationError(
      "AAL_REQUIRED",
      `Authenticator assurance level ${requiredAal} is required.`
    );
  }

  const context = { user, authorization, aal } as AuthorizationContext;
  verifiedAuthorizationContexts.add(context);
  return context;
}

export async function requireActiveUser(
  options: AuthorizationOptions = {}
): Promise<AuthorizationContext> {
  return getAuthenticatedAuthorization(options);
}

export async function requireActiveAdmin(
  options: AuthorizationOptions = {}
): Promise<AuthorizationContext> {
  const context = await getAuthenticatedAuthorization(options);

  if (!canAccessAdmin(context.authorization)) {
    throw new AuthorizationError("ADMIN_REQUIRED", "Administrator access is required.");
  }

  return context;
}

export async function requireCapability(
  capability: AuthorizationCapability,
  options: AuthorizationOptions = {}
): Promise<AuthorizationContext> {
  const context = await getAuthenticatedAuthorization(options);

  if (!hasAuthorizationCapability(context.authorization, capability)) {
    throw new AuthorizationError(
      "CAPABILITY_REQUIRED",
      `The ${capability} capability is required.`
    );
  }

  return context;
}
