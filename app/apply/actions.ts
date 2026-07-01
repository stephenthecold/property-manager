"use server";

import { headers } from "next/headers";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { rateLimitHit, RATE_LIMITS } from "@/lib/services/rate-limit";
import { submitApplication } from "@/lib/services/applications";
import { getAppSettings } from "@/lib/services/app-settings";
import { validateSubmission } from "@/lib/applications/form-config";
import {
  buildAnswerSnapshot,
  questionInputName,
  validateCustomAnswers,
  type CustomAnswers,
} from "@/lib/applications/custom-questions";
import { toCents } from "@/lib/money";
import { phoneKey } from "@/lib/portal/identity";
import { toE164 } from "@/lib/sms/phone";

export interface ApplyState {
  ok?: boolean;
  error?: string;
}

const str = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Length caps for the free-text fields on this PUBLIC, unauthenticated form, so
// a malicious client can't push unbounded blobs into the (unbounded) text
// columns. Generous enough for any legitimate applicant.
const MAX = {
  name: 100,
  email: 254,
  phone: 40,
  currentAddress: 300,
  employer: 200,
  message: 2000,
} as const;

export async function submitApplicationAction(
  _prev: ApplyState,
  fd: FormData,
): Promise<ApplyState> {
  // Public, unauthenticated form — throttle submissions per client IP to blunt
  // automated spam (on top of the per-field length caps below).
  const ip = clientIpFromXff((await headers()).get("x-forwarded-for"));
  if (!(await rateLimitHit(RATE_LIMITS.applySubmit, ip)).allowed) {
    return {
      error: "Too many submissions — please wait a little while and try again.",
    };
  }
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!firstName || !lastName) {
    return { error: "Please enter your first and last name." };
  }
  const email = str(fd, "email") || null;
  // Normalize to E.164 when confident so the stored application — and the tenant
  // created from it on approval — carries a provider-ready number; an
  // unparseable value is validated below and kept as typed.
  const phoneRaw = str(fd, "phone");
  const phone = phoneRaw ? (toE164(phoneRaw) ?? phoneRaw) : null;
  const currentAddress = str(fd, "currentAddress") || null;
  const employer = str(fd, "employer") || null;
  const message = str(fd, "message") || null;
  const moveRaw0 = str(fd, "desiredMoveInDate");
  const incomeRaw0 = str(fd, "monthlyIncome");

  // Bound + sanity-check the public input before any DB work.
  if (
    firstName.length > MAX.name ||
    lastName.length > MAX.name ||
    (email?.length ?? 0) > MAX.email ||
    (phone?.length ?? 0) > MAX.phone ||
    (currentAddress?.length ?? 0) > MAX.currentAddress ||
    (employer?.length ?? 0) > MAX.employer ||
    (message?.length ?? 0) > MAX.message
  ) {
    return { error: "One of your entries is too long. Please shorten it and try again." };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (phone && !phoneKey(phone)) {
    return { error: "Please enter a valid phone number." };
  }

  // Enforce the operator's per-field required config (Settings → Applications),
  // plus the always-on "at least one contact method" rule.
  const { applicationFields, applicationCustomSections } = await getAppSettings();
  const missing = validateSubmission(applicationFields, {
    email: !!email,
    phone: !!phone,
    currentAddress: !!currentAddress,
    desiredMoveInDate: !!moveRaw0,
    monthlyIncome: !!incomeRaw0,
    employer: !!employer,
    message: !!message,
  });

  // Collect + validate answers to the operator's custom questions.
  const customAnswers: CustomAnswers = {};
  for (const section of applicationCustomSections) {
    for (const q of section.questions) {
      const name = questionInputName(q.id);
      if (q.type === "multi_select") {
        customAnswers[q.id] = fd
          .getAll(name)
          .map((v) => String(v).trim())
          .filter((v) => v !== "");
      } else if (q.type === "yes_no") {
        customAnswers[q.id] = fd.get(name) ? "on" : "";
      } else {
        customAnswers[q.id] = str(fd, name);
      }
    }
  }
  const customMissing = validateCustomAnswers(applicationCustomSections, customAnswers);

  const allMissing = [...missing, ...customMissing];
  if (allMissing.length > 0) {
    return { error: `Please fill in: ${allMissing.join(", ")}.` };
  }
  const answerSnapshot = buildAnswerSnapshot(applicationCustomSections, customAnswers);

  const moveRaw = str(fd, "desiredMoveInDate");
  let desiredMoveInDate: Date | null = null;
  if (moveRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveRaw)) {
      return { error: "Enter a valid desired move-in date." };
    }
    desiredMoveInDate = new Date(`${moveRaw}T00:00:00Z`);
  }

  const incomeRaw = str(fd, "monthlyIncome");
  let monthlyIncomeCents: bigint | null = null;
  if (incomeRaw) {
    try {
      monthlyIncomeCents = toCents(incomeRaw);
    } catch {
      return { error: "Enter a valid monthly income amount." };
    }
  }

  try {
    await submitApplication({
      firstName,
      lastName,
      email,
      phone,
      currentAddress,
      desiredMoveInDate,
      monthlyIncomeCents,
      employer,
      message,
      unitId: str(fd, "unitId") || null,
      customAnswers: answerSnapshot,
      smsConsent: fd.get("smsConsent") === "on",
    });
  } catch {
    // Generic message — never leak module/DB internals to a public visitor.
    return {
      error: "Sorry, we couldn't submit your application right now. Please try again later.",
    };
  }
  return { ok: true };
}
