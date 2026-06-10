"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export interface EmergencyState {
  error?: string;
}

export async function signInBreakGlass(
  _prev: EmergencyState,
  formData: FormData,
): Promise<EmergencyState> {
  const passphrase = String(formData.get("passphrase") ?? "");
  if (!passphrase) return { error: "Enter the emergency passphrase." };
  try {
    await signIn("break-glass", { passphrase, redirectTo: "/dashboard" });
    return {};
  } catch (e) {
    // A successful sign-in throws a NEXT_REDIRECT which must propagate.
    if (e instanceof AuthError) {
      return { error: "Invalid, locked, or disabled emergency credentials." };
    }
    throw e;
  }
}
