import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/auth/crypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public invite/reset redemption page. Like /sign, the token is the only
 * credential: bad/expired tokens collapse to one neutral message revealing
 * nothing. The form posts the raw token; redemption is single-use and
 * race-guarded in the service.
 */
export default async function PortalInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let valid = false;
  let firstName: string | null = null;
  if (/^[0-9a-f]{64}$/.test(token)) {
    const account = await prisma.tenantPortalAccount.findUnique({
      where: { inviteTokenHash: sha256(token) },
      include: { tenant: { select: { firstName: true, isActive: true } } },
    });
    if (
      account &&
      account.isActive &&
      account.tenant.isActive &&
      account.inviteExpiresAt &&
      account.inviteExpiresAt > new Date()
    ) {
      valid = true;
      firstName = account.tenant.firstName;
    }
  }

  if (!valid) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-md items-center">
        <Card className="w-full">
          <CardContent className="py-10 text-center">
            <div className="text-lg font-semibold">
              This link is invalid or has expired.
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask your property manager to send a new invite, or use “Forgot
              your password?” on the sign-in page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {firstName ? `Welcome, ${firstName}` : "Welcome"} — choose your password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SetPasswordForm token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
