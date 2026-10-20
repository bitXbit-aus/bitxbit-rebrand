import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessActiveAccount,
  canAccessAdmin,
  hasAuthorizationCapability,
  meetsRequiredAal,
  type AuthorizationRecord,
} from "./authz-decision";

const activeAdmin: AuthorizationRecord = {
  userId: "user-1",
  role: "admin",
  status: "active",
  canManageUsers: true,
  canManageRewards: true,
  canManageContent: true,
  canManageFinancials: true,
  canManageSecurity: false,
};

describe("authorization decisions", () => {
  it("allows active accounts and rejects suspended or missing accounts", () => {
    assert.equal(canAccessActiveAccount(activeAdmin), true);
    assert.equal(canAccessActiveAccount({ ...activeAdmin, status: "suspended" }), false);
    assert.equal(canAccessActiveAccount({ ...activeAdmin, status: "deactivated" }), false);
    assert.equal(canAccessActiveAccount(null), false);
  });

  it("requires both the admin role and active status", () => {
    assert.equal(canAccessAdmin(activeAdmin), true);
    assert.equal(canAccessAdmin({ ...activeAdmin, role: "member" }), false);
    assert.equal(canAccessAdmin({ ...activeAdmin, status: "suspended" }), false);
  });

  it("checks explicit capabilities without treating admin as an automatic grant", () => {
    assert.equal(hasAuthorizationCapability(activeAdmin, "manage_users"), true);
    assert.equal(hasAuthorizationCapability(activeAdmin, "manage_security"), false);
    assert.equal(
      hasAuthorizationCapability(
        { ...activeAdmin, status: "suspended" },
        "manage_users"
      ),
      false
    );
  });

  it("supports AAL2 requirements while allowing AAL1 by default", () => {
    assert.equal(meetsRequiredAal("aal1", "aal1"), true);
    assert.equal(meetsRequiredAal("aal2", "aal1"), true);
    assert.equal(meetsRequiredAal("aal1", "aal2"), false);
    assert.equal(meetsRequiredAal(null, "aal2"), false);
  });
});
