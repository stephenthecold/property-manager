import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getTotpStatus } from "@/lib/services/totp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SecuritySettings } from "./security-settings";
import { setRequire2fa } from "./actions";

export const runtime = "nodejs";

/**
 * Self-service security center: every staff member manages their OWN 2FA here.
 * The org-wide enforcement toggle is owner-only and only rendered for the owner.
 */
export default async function SecuritySettingsPage() {
  const { dbUser } = await requireRole("viewer");
  const [status, app] = await Promise.all([
    getTotpStatus(dbUser.id),
    getAppSettings(),
  ]);
  const isOwner = dbUser.role === "owner";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Protect your account ({dbUser.email}) with a time-based one-time code
            from an authenticator app. {app.require2fa && !status.enrolled
              ? "Your organization requires 2FA — set it up to keep using the app."
              : null}
          </p>
          <SecuritySettings
            enrolled={status.enrolled}
            backupCodesRemaining={status.backupCodesRemaining}
          />
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization-wide enforcement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When enabled, every staff member must set up two-factor
              authentication before they can use the app. Break-glass emergency
              access is never affected. Owner-only setting.
            </p>
            <form action={setRequire2fa} className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
                <input
                  type="checkbox"
                  name="require2fa"
                  defaultChecked={app.require2fa}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    Require two-factor authentication for all staff
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Unenrolled staff are sent to set up 2FA the next time they
                    sign in. Existing sessions finish their current request.
                  </span>
                </span>
              </label>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
