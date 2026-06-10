"use server";

import { signIn, signOut } from "@/auth";

export async function signInWithAuthentik(): Promise<void> {
  await signIn("authentik", { redirectTo: "/dashboard" });
}

export async function doSignOut(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
