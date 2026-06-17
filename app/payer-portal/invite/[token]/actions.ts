"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { createPayerSession } from "@/lib/payer-portal/session";
import { acceptPayerInvite } from "@/lib/services/payer-portal-auth";

export interface SetPayerPasswordState {
  ok?: boolean;
  error?: string;
}

export async function setPayerPasswordAction(
  _prev: SetPayerPasswordState,
  fd: FormData,
): Promise<SetPayerPasswordState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  let result: Awaited<ReturnType<typeof acceptPayerInvite>>;
  try {
    result = await acceptPayerInvite({ token, password });
  } catch (e) {
    console.error("[payer-portal] invite acceptance failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  if (!result.ok) {
    return {
      error:
        result.code === "weak_password"
          ? "Password must be at least 8 characters."
          : "This link is invalid or has expired — ask the property manager for a new one.",
    };
  }

  const h = await headers();
  await createPayerSession(
    result.accountId,
    clientIpFromXff(h.get("x-forwarded-for")),
    h.get("user-agent"),
  );
  redirect("/payer-portal");
}
