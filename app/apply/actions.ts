"use server";

import { submitApplication } from "@/lib/services/applications";
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
  if (!email && !phone) {
    return { error: "Please provide an email or phone number so we can reach you." };
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
      currentAddress: str(fd, "currentAddress") || null,
      desiredMoveInDate,
      monthlyIncomeCents,
      employer: str(fd, "employer") || null,
      message: str(fd, "message") || null,
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
