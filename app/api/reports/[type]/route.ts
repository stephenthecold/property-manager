import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  getOverdue,
  getRentRoll,
  RENT_ROLL_HEADERS,
  toCsv,
} from "@/lib/services/reports";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { type } = await params;
  const now = new Date();
  let rows;
  let filename;
  if (type === "rent-roll") {
    rows = await getRentRoll(now);
    filename = "rent-roll.csv";
  } else if (type === "overdue") {
    rows = await getOverdue(now);
    filename = "overdue.csv";
  } else {
    return new NextResponse("Unknown report", { status: 404 });
  }

  const csv = toCsv(
    [...RENT_ROLL_HEADERS],
    rows as unknown as Record<string, string>[],
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
