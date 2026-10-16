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
