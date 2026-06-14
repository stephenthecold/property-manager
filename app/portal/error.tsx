"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Tenant-facing error boundary for the portal — never the opaque error page. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal error boundary]", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4">
      <Card className="w-full">
        <CardContent className="space-y-4 py-10 text-center">
          <div className="text-lg font-semibold">Something went wrong</div>
          <p className="text-sm text-muted-foreground">
            That didn&apos;t complete. Please try again, or contact your
            property manager if it keeps happening.
          </p>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}
