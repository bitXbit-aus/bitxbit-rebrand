import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_BULK_USER_IDS,
  assertSecurityAdminRemovalSafe,
  shouldRecordOfferClick,
  requiresSecurityAuthorization,
  validateUserIds,
  validateUserRole,
  validateUserStatus,
  type SecurityAdminState,
} from "./security-mutations";

const actorId = "11111111-1111-4111-8111-111111111111";
const secondAdminId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";

function securityAdmin(id: string): SecurityAdminState {
  return { id, role: "admin", status: "active", canManageSecurity: true };
}

describe("security-sensitive user mutations", () => {
  it("classifies every promotion and demotion as a security-authorized change", () => {
    assert.equal(requiresSecurityAuthorization("member", "admin"), true);
    assert.equal(requiresSecurityAuthorization("admin", "member"), true);
    assert.equal(requiresSecurityAuthorization("admin", "admin"), false);
    assert.equal(requiresSecurityAuthorization("member", "member"), false);
  });

  it("validates bounded unique UUID selections and enum values", () => {
    assert.deepEqual(validateUserIds([actorId, memberId]), [actorId, memberId]);
    assert.throws(() => validateUserIds([]), /At least one user/);
    assert.throws(() => validateUserIds([actorId, actorId]), /unique valid UUIDs/);
    assert.throws(
      () => validateUserIds(Array.from({ length: MAX_BULK_USER_IDS + 1 }, (_, index) =>
        `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`
      )),
      /No more than/
    );
    assert.equal(validateUserRole("admin"), "admin");
    assert.equal(validateUserStatus("deactivated"), "deactivated");
    assert.throws(() => validateUserRole("owner"), /Invalid user role/);
    assert.throws(() => validateUserStatus("deleted"), /Invalid user status/);
  });

  it("prevents caller self-demotion, self-disable, and self-delete", () => {
    const target = securityAdmin(actorId);
    assert.throws(() => assertSecurityAdminRemovalSafe({
      actorId,
      targets: [target],
      allActiveSecurityAdminIds: [actorId, secondAdminId],
      nextRole: "member",
    }), /cannot demote/);
    assert.throws(() => assertSecurityAdminRemovalSafe({
      actorId,
      targets: [target],
      allActiveSecurityAdminIds: [actorId, secondAdminId],
      nextStatus: "suspended",
    }), /cannot demote/);
    assert.throws(() => assertSecurityAdminRemovalSafe({
      actorId,
      targets: [target],
      allActiveSecurityAdminIds: [actorId, secondAdminId],
      deleting: true,
    }), /cannot demote/);
  });

  it("prevents removing the final active security-capable administrator", () => {
    const onlyAdmin = securityAdmin(secondAdminId);
    assert.throws(() => assertSecurityAdminRemovalSafe({
      actorId,
      targets: [onlyAdmin],
      allActiveSecurityAdminIds: [secondAdminId],
      nextRole: "member",
    }), /must remain/);

    assert.doesNotThrow(() => assertSecurityAdminRemovalSafe({
      actorId,
      targets: [onlyAdmin],
      allActiveSecurityAdminIds: [actorId, secondAdminId],
      nextRole: "member",
    }));
  });
});

describe("trusted offer click dedupe", () => {
  it("records the first click and suppresses clicks within the server window", () => {
    const now = new Date("2026-10-16T00:00:30.000Z");
    assert.equal(shouldRecordOfferClick(null, now), true);
    assert.equal(shouldRecordOfferClick(new Date("2026-10-16T00:00:01.000Z"), now), false);
    assert.equal(shouldRecordOfferClick(new Date("2026-10-16T00:00:00.000Z"), now), true);
  });
});
