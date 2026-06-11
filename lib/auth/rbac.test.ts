import { describe, it, expect } from "vitest";
import {
  ROLE_ORDER,
  effectiveRole,
  isRole,
  roleAtLeast,
  roleRank,
} from "@/lib/auth/rbac";

describe("role hierarchy with finance", () => {
  it("orders viewer < manager < finance < admin < owner", () => {
    expect(ROLE_ORDER).toEqual(["viewer", "manager", "finance", "admin", "owner"]);
    expect(roleRank("finance")).toBeGreaterThan(roleRank("manager"));
    expect(roleRank("finance")).toBeLessThan(roleRank("admin"));
  });

  it("finance clears manager gates but not admin gates", () => {
    expect(roleAtLeast("finance", "manager")).toBe(true);
    expect(roleAtLeast("finance", "finance")).toBe(true);
    expect(roleAtLeast("finance", "admin")).toBe(false);
    expect(roleAtLeast("manager", "finance")).toBe(false);
  });

  it("isRole accepts only real roles", () => {
    expect(isRole("finance")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole("")).toBe(false);
  });
});

describe("effectiveRole (view-as impersonation)", () => {
  it("lets admin+ act as a lower role", () => {
    expect(effectiveRole("admin", "viewer")).toBe("viewer");
    expect(effectiveRole("admin", "finance")).toBe("finance");
    expect(effectiveRole("owner", "manager")).toBe("manager");
  });

  it("never raises privileges", () => {
    expect(effectiveRole("admin", "owner")).toBe("admin");
    expect(effectiveRole("manager", "admin")).toBe("manager");
    expect(effectiveRole("viewer", "owner")).toBe("viewer");
  });

  it("ignores view-as for non-admin users entirely", () => {
    expect(effectiveRole("finance", "viewer")).toBe("finance");
    expect(effectiveRole("manager", "viewer")).toBe("manager");
  });

  it("no cookie means the real role", () => {
    expect(effectiveRole("admin", null)).toBe("admin");
  });
});
