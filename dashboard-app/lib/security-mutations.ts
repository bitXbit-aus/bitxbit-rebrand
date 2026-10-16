export const MAX_BULK_USER_IDS = 100;
export const OFFER_CLICK_DEDUPE_SECONDS = 30;

export type ManagedUserRole = "member" | "admin";
export type ManagedUserStatus = "active" | "suspended" | "deactivated";

export interface SecurityAdminState {
  id: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
  canManageSecurity: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function validateUserIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("At least one user must be selected.");
  }
  if (ids.length > MAX_BULK_USER_IDS) {
    throw new Error(`No more than ${MAX_BULK_USER_IDS} users may be changed at once.`);
  }

  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length !== ids.length || uniqueIds.some((id) => !isUuid(id))) {
    throw new Error("User IDs must be unique valid UUIDs.");
  }
  return uniqueIds;
}

export function validateUserRole(role: string): ManagedUserRole {
  if (role !== "member" && role !== "admin") {
    throw new Error("Invalid user role.");
  }
  return role;
}

export function validateUserStatus(status: string): ManagedUserStatus {
  if (status !== "active" && status !== "suspended" && status !== "deactivated") {
    throw new Error("Invalid user status.");
  }
  return status;
}

export function requiresSecurityAuthorization(
  currentRole: ManagedUserRole,
  nextRole: ManagedUserRole
): boolean {
  return currentRole !== nextRole;
}

export function isActiveSecurityAdmin(user: SecurityAdminState): boolean {
  return user.role === "admin" && user.status === "active" && user.canManageSecurity;
}

export function assertSecurityAdminRemovalSafe(options: {
  actorId: string;
  targets: SecurityAdminState[];
  allActiveSecurityAdminIds: string[];
  nextRole?: ManagedUserRole;
  nextStatus?: ManagedUserStatus;
  deleting?: boolean;
}): void {
  const { actorId, targets, allActiveSecurityAdminIds, nextRole, nextStatus, deleting } = options;
  const removesActor = targets.some((target) => target.id === actorId) &&
    (deleting || nextRole === "member" || (nextStatus !== undefined && nextStatus !== "active"));
  if (removesActor) {
    throw new Error("You cannot demote, deactivate, suspend, or delete your own account.");
  }

  const removedSecurityAdminIds = new Set(
    targets
      .filter(isActiveSecurityAdmin)
      .filter(() => deleting || nextRole === "member" || (nextStatus !== undefined && nextStatus !== "active"))
      .map((target) => target.id)
  );
  const remaining = allActiveSecurityAdminIds.filter((id) => !removedSecurityAdminIds.has(id));
  if (removedSecurityAdminIds.size > 0 && remaining.length === 0) {
    throw new Error("At least one active administrator with security capability must remain.");
  }
}

export function shouldRecordOfferClick(
  lastClickAt: Date | null,
  now: Date,
  dedupeSeconds = OFFER_CLICK_DEDUPE_SECONDS
): boolean {
  if (!lastClickAt) return true;
  return now.getTime() - lastClickAt.getTime() >= dedupeSeconds * 1000;
}
