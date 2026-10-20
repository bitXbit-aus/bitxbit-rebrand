export type AuthorizationRole = "member" | "admin";
export type AuthorizationStatus = "active" | "suspended" | "deactivated";
export type AuthenticatorAssuranceLevel = "aal1" | "aal2";
export type AuthorizationCapability =
  | "manage_users"
  | "manage_rewards"
  | "manage_content"
  | "manage_financials"
  | "manage_security";

export interface AuthorizationRecord {
  userId: string;
  role: AuthorizationRole;
  status: AuthorizationStatus;
  canManageUsers: boolean;
  canManageRewards: boolean;
  canManageContent: boolean;
  canManageFinancials: boolean;
  canManageSecurity: boolean;
}

const capabilityFields: Record<
  AuthorizationCapability,
  keyof Pick<
    AuthorizationRecord,
    | "canManageUsers"
    | "canManageRewards"
    | "canManageContent"
    | "canManageFinancials"
    | "canManageSecurity"
  >
> = {
  manage_users: "canManageUsers",
  manage_rewards: "canManageRewards",
  manage_content: "canManageContent",
  manage_financials: "canManageFinancials",
  manage_security: "canManageSecurity",
};

export function canAccessActiveAccount(
  authorization: AuthorizationRecord | null
): authorization is AuthorizationRecord {
  return authorization?.status === "active";
}

export function canAccessAdmin(authorization: AuthorizationRecord | null): boolean {
  return canAccessActiveAccount(authorization) && authorization.role === "admin";
}

export function hasAuthorizationCapability(
  authorization: AuthorizationRecord | null,
  capability: AuthorizationCapability
): boolean {
  return (
    canAccessActiveAccount(authorization) &&
    authorization[capabilityFields[capability]] === true
  );
}

export function meetsRequiredAal(
  currentAal: AuthenticatorAssuranceLevel | null,
  requiredAal: AuthenticatorAssuranceLevel = "aal1"
): boolean {
  if (requiredAal === "aal1") return currentAal === "aal1" || currentAal === "aal2";
  return currentAal === "aal2";
}
