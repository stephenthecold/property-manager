import { requireRole } from "@/lib/auth/session";
import { SettingsNav } from "@/components/app/settings-nav";

export const runtime = "nodejs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("owner");
  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Owner-only configuration. Every change is audited.
        </p>
      </div>
      <SettingsNav />
      {children}
    </div>
  );
}
