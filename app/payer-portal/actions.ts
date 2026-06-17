"use server";

import { redirect } from "next/navigation";
import { destroyPayerSession } from "@/lib/payer-portal/session";

export async function signOutPayerAction(): Promise<void> {
  await destroyPayerSession();
  redirect("/payer-portal/login");
}
