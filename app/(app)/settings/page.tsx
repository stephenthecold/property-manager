import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function SettingsIndexPage() {
  redirect("/settings/organization");
}
