"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Button that pops a dialog around a server-rendered form (server actions
 * included). The page keeps showing the saved values; the form only appears
 * in the pop-out.
 *
 * The forms inside don't know about the dialog, so when one passes native
 * validation and submits we close immediately and refresh shortly after —
 * the action's own revalidation may be dropped once the form unmounts.
 */
export function FormDialog({
  trigger,
  triggerVariant = "outline",
  triggerSize = "sm",
  title,
  description,
  wide = false,
  children,
}: {
  trigger: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm" | "xs" | "lg";
  title: string;
  description?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  function handleSubmit() {
    setOpen(false);
    setTimeout(() => router.refresh(), 400);
    setTimeout(() => router.refresh(), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={triggerVariant} size={triggerSize} />}
      >
        {trigger}
      </DialogTrigger>
      <DialogContent
        className={cn(
          "max-h-[85vh] overflow-y-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div onSubmit={handleSubmit}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
