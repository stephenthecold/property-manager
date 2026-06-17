import { redirect } from "next/navigation";
import { getPayerSession } from "@/lib/payer-portal/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayerLoginForm } from "./login-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PayerPortalLoginPage() {
  if (await getPayerSession()) redirect("/payer-portal");

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <PayerLoginForm />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            No account yet? Ask the property manager for an invite link.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
