import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { roleRank } from "@/lib/auth/rbac";
import type { Role } from "@/lib/generated/prisma/enums";
import { setUserRole, setUserActive, setUserNotifications, startViewAs } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";

export const runtime = "nodejs";

// Assignable from this page. Owner stays a placeholder granted outside the UI.
const ASSIGNABLE_ROLES = ["viewer", "manager", "finance", "admin"] as const;
const VIEW_AS_ROLES = ["viewer", "manager", "finance"] as const;

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { dbUser: me } = await requireCapability("users.manage");
  const { error } = await searchParams;
  // Sort by hierarchy (highest first) in JS: the Postgres enum order doesn't
  // match ROLE_ORDER ('finance' was appended by ALTER TYPE ADD VALUE).
  const users = (
    await prisma.user.findMany({ orderBy: { email: "asc" } })
  ).sort(
    (a, b) =>
      roleRank(b.role as Role) - roleRank(a.role as Role) ||
      a.email.localeCompare(b.email),
  );

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users &amp; roles</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Role changes take effect on the user&apos;s next request (their current
            session token is invalidated). Viewer &lt; manager &lt; finance &lt; admin;
            finance is a CFO-style role — manager powers plus billing rates, no
            operational settings. You cannot change your own role or deactivate
            yourself.
          </p>
          <DataTable
            emptyMessage="No staff users yet."
            columns={[
              { key: "email", label: "Email" },
              { key: "name", label: "Name", className: "hidden sm:table-cell" },
              { key: "role", label: "Role", numeric: true },
              { key: "status", label: "Status" },
              { key: "alerts", label: "Alerts", className: "hidden lg:table-cell", sortable: false },
              { key: "actions", label: "Actions", align: "right", sortable: false },
            ]}
            rows={users.map((u) => {
              const isSelf = u.id === me.id;
              const isOwnerRow = u.role === "owner" && me.role !== "owner";
              const locked = isSelf || isOwnerRow;
              return {
                key: u.id,
                sortValues: [
                  u.email,
                  u.name,
                  roleRank(u.role as Role),
                  u.isActive ? "Active" : "Disabled",
                  null,
                  null,
                ],
                cells: [
                  <span key="e" className="font-medium">
                    {u.email}
                    {isSelf && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </span>,
                  u.name ?? "—",
                  locked ? (
                    <span key="r" className="capitalize">
                      {u.role}
                    </span>
                  ) : (
                    <form key="r" action={setUserRole} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        className="h-8 rounded-md border px-2 text-sm capitalize"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Save
                      </Button>
                    </form>
                  ),
                  u.isActive ? (
                    <Badge
                      key="s"
                      variant="outline"
                      className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge key="s" variant="outline" className="text-muted-foreground">
                      Disabled
                    </Badge>
                  ),
                  <FormDialog
                    key="n"
                    trigger="Notifications"
                    title={`Notifications — ${u.email}`}
                    description="Which staff alerts this user receives. Digests and alerts only go to manager and above."
                  >
                    <form action={setUserNotifications} className="space-y-3">
                      <input type="hidden" name="userId" value={u.id} />
                      {(
                        [
                          ["notifyOverdueDigest", "Weekly overdue-rent digest", u.notifyOverdueDigest],
                          ["notifyMaintenanceDigest", "Weekly maintenance digest", u.notifyMaintenanceDigest],
                          ["notifyLeaseExpiration", "Weekly lease-expiration digest", u.notifyLeaseExpiration],
                          ["notifyCashPickup", "Cash-pickup alerts (email + text)", u.notifyCashPickup],
                        ] as const
                      ).map(([name, label, checked]) => (
                        <label key={name} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name={name}
                            defaultChecked={checked}
                            className="size-4 accent-primary"
                          />
                          {label}
                        </label>
                      ))}
                      <div className="space-y-1">
                        <Label htmlFor={`phone-${u.id}`}>Mobile for text alerts</Label>
                        <Input
                          id={`phone-${u.id}`}
                          name="phone"
                          type="tel"
                          defaultValue={u.phone ?? ""}
                          placeholder="+1 555 000 1234"
                        />
                      </div>
                      <Button type="submit" size="sm">
                        Save
                      </Button>
                    </form>
                  </FormDialog>,
                  locked ? (
                    <span key="a" className="text-xs text-muted-foreground">
                      —
                    </span>
                  ) : (
                    <form key="a" action={setUserActive} className="inline">
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        type="hidden"
                        name="isActive"
                        value={u.isActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {u.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                  ),
                ],
              };
            })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">View as role</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Temporarily experience the app as a lower role to verify what it can
            see and do. Your real permissions are restored with the Exit button in
            the banner. Impersonation can only lower privileges, never raise them.
          </p>
          <div className="flex gap-2">
            {VIEW_AS_ROLES.map((r) => (
              <form key={r} action={startViewAs}>
                <input type="hidden" name="role" value={r} />
                <Button type="submit" variant="outline" size="sm" className="capitalize">
                  View as {r}
                </Button>
              </form>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
