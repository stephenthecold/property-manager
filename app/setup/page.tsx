import Link from "next/link";
import { needsSetup } from "@/lib/auth/setup";
import { SetupForm } from "./setup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const open = await needsSetup();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>First-run setup</CardTitle>
          <CardDescription>Create the first owner account.</CardDescription>
        </CardHeader>
        <CardContent>
          {open ? (
            <SetupForm token={token ?? ""} />
          ) : (
            <Alert>
              <AlertTitle>Setup already completed</AlertTitle>
              <AlertDescription>
                A user already exists.{" "}
                <Link href="/login" className="underline">
                  Go to sign in
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
