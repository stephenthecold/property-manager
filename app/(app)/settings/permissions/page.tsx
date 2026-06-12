import { Fragment } from "react";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  CAPABILITIES,
  CAPABILITY_META,
  type Capability,
  isLocked,
  resolveMatrix,
} from "@/lib/auth/permissions";
import type { Role } from "@/lib/generated/prisma/enums";
import { savePermissionsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

const COLUMNS: Role[] = ["viewer", "manager", "finance", "admin", "owner"];
const GROUPS = ["Operations", "Settings"] as const;

export default async function PermissionsSettingsPage() {
  await requireCapability("users.manage");
  const { rolePermissions } = await getAppSettings();
  const grid = resolveMatrix(rolePermissions);

  const byGroup = (g: (typeof GROUPS)[number]) =>
    CAPABILITIES.filter((c) => CAPABILITY_META[c].group === g);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Role permissions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Assign capabilities to each role. Defaults match the built-in hierarchy
          (viewer &lt; manager &lt; finance &lt; admin); change any checkbox to
          customize. <span className="font-medium text-foreground">Owner</span>{" "}
          always has everything, and a couple of admin capabilities are locked on
          so a mistake can&apos;t lock administrators out. Changes take effect on
          each user&apos;s next request.
        </p>

        <form action={savePermissionsAction} className="space-y-6">
          <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/60">
                  <th className="p-2 text-left font-medium">Capability</th>
                  {COLUMNS.map((role) => (
                    <th key={role} className="p-2 text-center font-medium capitalize">
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr className="border-b bg-muted/30">
                      <td
                        colSpan={COLUMNS.length + 1}
                        className="px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                      >
                        {group}
                      </td>
                    </tr>
                    {byGroup(group).map((cap: Capability) => (
                      <tr key={cap} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-2">
                          <div className="font-medium">{CAPABILITY_META[cap].label}</div>
                          <div className="text-xs text-muted-foreground">
                            {CAPABILITY_META[cap].description}
                          </div>
                        </td>
                        {COLUMNS.map((role) => {
                          const locked = isLocked(role, cap);
                          const checked = grid[role][cap];
                          return (
                            <td key={role} className="p-2 text-center">
                              <input
                                type="checkbox"
                                name={`perm:${role}:${cap}`}
                                defaultChecked={checked}
                                disabled={locked}
                                aria-label={`${role} ${CAPABILITY_META[cap].label}`}
                                className="size-4 accent-primary disabled:opacity-40"
                                title={locked ? "Locked (cannot be changed)" : undefined}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="submit" size="sm">
            Save permissions
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
