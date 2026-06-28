import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  type Capability,
  defaultGrant,
  diffFromDefault,
  hasCapability,
  isLocked,
  resolveMatrix,
} from "@/lib/auth/permissions";
import { roleAtLeast } from "@/lib/auth/rbac";
import type { Role } from "@/lib/generated/prisma/enums";

const ROLES: Role[] = ["viewer", "manager", "finance", "admin", "owner"];

/** The exact role gate each capability used before the matrix existed. */
const LEGACY_MIN: Record<Capability, Role> = {
  "properties.manage": "manager",
  "tenants.manage": "manager",
  "leases.manage": "manager",
  "payments.manage": "manager",
  // payers.manage is new (no legacy gate); manager mirrors tenants.manage.
  "payers.manage": "manager",
  "documents.manage": "manager",
  "reminders.send": "manager",
  "reports.view": "manager",
  // reports.schedule is new (no legacy gate); admin floor — it configures
  // automated outbound email, like messaging.settings.
  "reports.schedule": "admin",
  "financials.view": "finance",
  "financials.manage": "finance",
  "maintenance.manage": "manager",
  // esign.manage is new (no true legacy gate); manager mirrors leases.manage,
  // matching the product rule that managers+ sign the landlord side.
  "esign.manage": "manager",
  // portal.manage is new (no legacy gate); manager mirrors tenants.manage —
  // the staff who manage tenants also manage their portal access/requests.
  "portal.manage": "manager",
  // portal.impersonate is new and sensitive — admin floor (no legacy gate).
  "portal.impersonate": "admin",
  // applications.* are new (no legacy gate); manager mirrors tenants.manage —
  // the staff who manage tenants also review/convert applicants.
  "applications.view": "manager",
  "applications.manage": "manager",
  // notices.manage is new (no legacy gate); manager mirrors leases.manage.
  "notices.manage": "manager",
  // inspections.manage is new (no legacy gate); manager mirrors leases.manage.
  "inspections.manage": "manager",
  // vendors.manage is new (no legacy gate); manager mirrors maintenance.manage.
  "vendors.manage": "manager",
  // mailbox.manage is new (no legacy gate); manager mirrors documents.manage.
  "mailbox.manage": "manager",
  "billing.settings": "finance",
  "messaging.settings": "admin",
  "organization.settings": "admin",
  "auth.settings": "admin",
  "users.manage": "admin",
  "audit.view": "admin",
};

describe("permissions default matrix", () => {
  it("reproduces the original role hierarchy with no overrides", () => {
    for (const role of ROLES) {
      for (const cap of CAPABILITIES) {
        expect(hasCapability(role, cap, null)).toBe(
          roleAtLeast(role, LEGACY_MIN[cap]),
        );
      }
    }
  });

  it("owner always has every capability, even with a hostile matrix", () => {
    const denyAll = { owner: Object.fromEntries(CAPABILITIES.map((c) => [c, false])) };
    for (const cap of CAPABILITIES) {
      expect(hasCapability("owner", cap, denyAll as never)).toBe(true);
    }
  });

  it("keeps admin's recovery capabilities locked on", () => {
    const strip = { admin: { "users.manage": false, "auth.settings": false } };
    expect(hasCapability("admin", "users.manage", strip as never)).toBe(true);
    expect(hasCapability("admin", "auth.settings", strip as never)).toBe(true);
    expect(isLocked("admin", "users.manage")).toBe(true);
    expect(isLocked("owner", "audit.view")).toBe(true);
  });
});

describe("matrix overrides", () => {
  it("applies an explicit grant above the default", () => {
    const m = { viewer: { "reports.view": true } };
    expect(hasCapability("viewer", "reports.view", m)).toBe(true);
    expect(defaultGrant("viewer", "reports.view")).toBe(false);
  });

  it("applies an explicit revoke below the default", () => {
    const m = { manager: { "payments.manage": false } };
    expect(hasCapability("manager", "payments.manage", m)).toBe(false);
  });

  it("diffFromDefault keeps only real, unlocked, non-owner changes", () => {
    const full = {
      viewer: { "reports.view": true, "tenants.manage": false /* == default, dropped */ },
      admin: { "users.manage": false /* locked, dropped */, "billing.settings": false /* real change */ },
      owner: { "audit.view": false /* owner, dropped */ },
    };
    const diff = diffFromDefault(full as never);
    expect(diff).toEqual({
      viewer: { "reports.view": true },
      admin: { "billing.settings": false },
    });
  });

  it("resolveMatrix returns a full role×capability grid", () => {
    const grid = resolveMatrix(null);
    expect(grid.manager["leases.manage"]).toBe(true);
    expect(grid.viewer["leases.manage"]).toBe(false);
    expect(Object.keys(grid.owner)).toHaveLength(CAPABILITIES.length);
  });
});
