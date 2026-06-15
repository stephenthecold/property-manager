"use server";

import { submitApplication } from "@/lib/services/applications";
import { getAppSettings } from "@/lib/services/app-settings";
import { validateSubmission } from "@/lib/applications/form-config";
import { toCents } from "@/lib/money";

export interface ApplyState {
  ok?: boolean;
  error?: string;
}

const str = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();

export async function submitApplicationAction(
  _prev: ApplyState,
  fd: FormData,
): Promise<ApplyState> {
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!firstName || !lastName) {
    return { error: "Please enter your first and last name." };
  }
  const email = str(fd, "email") || null;
  const phone = str(fd, "phone") || null;
  const currentAddress = str(fd, "currentAddress") || null;
  const employer = str(fd, "employer") || null;
  const message = str(fd, "message") || null;
  const moveRaw0 = str(fd, "desiredMoveInDate");
  const incomeRaw0 = str(fd, "monthlyIncome");

  // Enforce the operator's per-field required config (Settings → Applications),
  // plus the always-on "at least one contact method" rule.
  const { applicationFields } = await getAppSettings();
  const missing = validateSubmission(applicationFields, {
    email: !!email,
    phone: !!phone,
    currentAddress: !!currentAddress,
    desiredMoveInDate: !!moveRaw0,
    monthlyIncome: !!incomeRaw0,
    employer: !!employer,
    message: !!message,
  });
  if (missing.length > 0) {
    return { error: `Please fill in: ${missing.join(", ")}.` };
  }

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
    });
  } catch {
    // Generic message — never leak module/DB internals to a public visitor.
    return {
      error: "Sorry, we couldn't submit your application right now. Please try again later.",
    };
  }
  return { ok: true };
}
