import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PortalForgotPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reset your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the email or phone number on your account and we&apos;ll send
            a link to choose a new password.
          </p>
          <ForgotPasswordForm />
          <p className="text-center text-xs">
            <Link href="/portal/login" className="text-muted-foreground hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
