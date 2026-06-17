import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/auth/crypto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetPayerPasswordForm } from "./set-password-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public invite/reset redemption page. The token is the only credential:
 * bad/expired tokens collapse to one neutral message. Redemption is single-use
 * and race-guarded in the service.
 */
export default async function PayerInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let valid = false;
  let payerName: string | null = null;
  if (/^[0-9a-f]{64}$/.test(token)) {
    const account = await prisma.payerPortalAccount.findUnique({
      where: { inviteTokenHash: sha256(token) },
      include: { payer: { select: { name: true, isActive: true } } },
    });
    if (
      account &&
      account.isActive &&
      account.payer.isActive &&
      account.inviteExpiresAt &&
      account.inviteExpiresAt > new Date()
    ) {
      valid = true;
      payerName = account.payer.name;
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
              Ask the property manager to send a new invite.
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
            {payerName ? `Welcome, ${payerName}` : "Welcome"} — choose your password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SetPayerPasswordForm token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
