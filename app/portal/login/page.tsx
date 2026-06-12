import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalLoginForm } from "./login-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PortalLoginPage() {
  if (await getPortalSession()) redirect("/portal");

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <PortalLoginForm />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            No account yet? Ask your property manager for an invite link.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
