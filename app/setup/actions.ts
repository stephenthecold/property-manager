"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createFirstOwner,
  needsSetup,
  verifyBootstrapToken,
} from "@/lib/auth/setup";

export interface SetupState {
  error?: string;
}

export async function createOwnerAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");

  if (!email || !name) return { error: "Name and email are required." };
  if (!verifyBootstrapToken(token)) return { error: "Invalid bootstrap token." };
  if (!(await needsSetup())) return { error: "Setup has already been completed." };

  const h = await headers();
  try {
    await createFirstOwner({
      email,
      name,
      ip: h.get("x-forwarded-for"),
      userAgent: h.get("user-agent"),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Setup failed." };
  }
  redirect("/emergency?created=1");
}
