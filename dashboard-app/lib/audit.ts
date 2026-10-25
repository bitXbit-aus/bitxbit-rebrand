import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import type { AuthorizationContext } from "@/lib/authz";
import { assertVerifiedAuthorizationContext } from "@/lib/authz";

export interface AuditEntry {
  action: string;
  targetTable: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
  success?: boolean;
  errorMessage?: string | null;
}

/**
 * Writes an application-level audit event after authorization has succeeded.
 * Callers must pass a context returned by requireActiveUser/Admin/Capability.
 */
export async function writeSecurityAudit(
  context: AuthorizationContext,
  entry: AuditEntry
): Promise<void> {
  assertVerifiedAuthorizationContext(context);
  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from("security_audit_log").insert({
    actor_id: context.user.id,
    actor_role: context.authorization.role,
    actor_status: context.authorization.status,
    actor_authorization: {
      can_manage_users: context.authorization.canManageUsers,
      can_manage_rewards: context.authorization.canManageRewards,
      can_manage_content: context.authorization.canManageContent,
      can_manage_financials: context.authorization.canManageFinancials,
      can_manage_security: context.authorization.canManageSecurity,
      aal: context.aal,
    },
    action: entry.action,
    target_table: entry.targetTable,
    target_id: entry.targetId ?? null,
    before_data: entry.before ?? null,
    after_data: entry.after ?? null,
    metadata: entry.metadata ?? {},
    request_id: entry.requestId ?? null,
    success: entry.success ?? true,
    error_message: entry.errorMessage ?? null,
  });

  if (error) {
    throw new Error(`Failed to write security audit event: ${error.message}`);
  }
}

/**
 * An audit entry for a request that has NOT been authenticated.
 *
 * `writeSecurityAudit` asserts a verified AuthorizationContext, which an
 * unauthenticated sign-in does not have — so it cannot be reused here, and
 * manufacturing a context to satisfy it would attribute an anonymous action to an
 * identity that never proved anything. `security_audit_log.actor_id` is nullable
 * for exactly this case, so anonymous events are recorded honestly instead.
 *
 * `actorId` is set only when the request resolved to a REAL account (a successful
 * sign-in). Failed attempts leave it null. Never pass unverified caller input as
 * the actor.
 */
export interface AnonymousAuditEntry extends AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  actorStatus?: string | null;
}

export async function writeAnonymousSecurityAudit(
  entry: AnonymousAuditEntry
): Promise<void> {
  const serviceClient = createServiceClient();
  const { actorId, actorRole, actorStatus, ...audit } = entry;
  const { error } = await serviceClient.from("security_audit_log").insert({
    actor_id: actorId ?? null,
    actor_role: actorRole ?? null,
    actor_status: actorStatus ?? null,
    actor_authorization: {},
    action: audit.action,
    target_table: audit.targetTable,
    target_id: audit.targetId ?? null,
    before_data: audit.before ?? null,
    after_data: audit.after ?? null,
    metadata: audit.metadata ?? {},
    request_id: audit.requestId ?? null,
    success: audit.success ?? true,
    error_message: audit.errorMessage ?? null,
  });

  if (error) {
    throw new Error(`Failed to write anonymous security audit event: ${error.message}`);
  }
}
