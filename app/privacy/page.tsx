import { redirect } from "next/navigation";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  DEFAULT_PRIVACY_POLICY,
  fillPolicyTemplate,
} from "@/lib/config/compliance";
import { LegalDocPage } from "@/components/app/legal-doc-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public privacy policy (10DLC / A2P). NO session — "/privacy" is a
 * PUBLIC_PREFIX. An external-URL override redirects off-site; otherwise the
 * operator-authored text is hosted here, falling back to a shipped default that
 * already includes the required mobile/SMS data-handling clause (so the policy
 * the SMS consent links point to is always present and compliant).
 */
export default async function PrivacyPolicyPage() {
  const s = await getAppSettings();

  const external = s.privacyPolicyUrl?.trim();
  if (external) redirect(external);

  const text =
    s.privacyPolicyText?.trim() ||
    fillPolicyTemplate(DEFAULT_PRIVACY_POLICY, s.businessName);

  return (
    <LegalDocPage
      businessName={s.businessName}
      title="Privacy Policy"
      text={text}
    />
  );
}
