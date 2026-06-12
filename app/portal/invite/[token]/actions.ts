"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { createPortalSession } from "@/lib/portal/session";
import { acceptPortalInvite } from "@/lib/services/portal-auth";

export interface SetPasswordState {
  ok?: boolean;
  error?: string;
}

export async function setPortalPasswordAction(
  _prev: SetPasswordState,
  fd: FormData,
): Promise<SetPasswordState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  let result: Awaited<ReturnType<typeof acceptPortalInvite>>;
  try {
    result = await acceptPortalInvite({ token, password });
  } catch (e) {
    console.error("[portal] invite acceptance failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  if (!result.ok) {
    return {
      error:
        result.code === "weak_password"
          ? "Password must be at least 8 characters."
          : "This link is invalid or has expired — ask your property manager for a new one.",
    };
  }

  const h = await headers();
  await createPortalSession(
    result.accountId,
    clientIpFromXff(h.get("x-forwarded-for")),
    h.get("user-agent"),
  );
  redirect("/portal");
}
