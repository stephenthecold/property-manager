import { notFound, redirect } from "next/navigation";
import { getAppSettings } from "@/lib/services/app-settings";
import { LegalDocPage } from "@/components/app/legal-doc-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public privacy policy (10DLC / A2P). NO session — "/privacy" is a
 * PUBLIC_PREFIX. An external-URL override redirects off-site; otherwise the
 * operator-authored text is hosted here; with neither set the route 404s.
 */
export default async function PrivacyPolicyPage() {
  const s = await getAppSettings();

  const external = s.privacyPolicyUrl?.trim();
  if (external) redirect(external);

  const text = s.privacyPolicyText?.trim();
  if (!text) notFound();

  return (
    <LegalDocPage
      businessName={s.businessName}
      title="Privacy Policy"
      text={text}
    />
  );
}
