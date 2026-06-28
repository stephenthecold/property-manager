import { DateTime } from "luxon";
import { prisma } from "@/lib/db";

export interface OverdueRecurringTask {
  taskId: string;
  title: string;
  propertyName: string;
  timezone: string;
  /** "yyyy-MM-dd" — this month's due date in the property timezone. */
  dueISO: string;
  daysOverdue: number;
}

/**
 * Active monthly recurring tasks whose THIS-MONTH occurrence is past its due day
 * (property timezone) with no RecurringTaskExecution recorded for the period —
 * i.e. preventive maintenance that staff haven't marked done. Tasks created
 * after this month's due date are skipped (not expected yet). Shared by the
 * weekly preventive-maintenance digest. Most-overdue first. DB read only.
 */
export async function listOverdueRecurringTasks(
  now: Date,
): Promise<OverdueRecurringTask[]> {
  const tasks = await prisma.recurringTask.findMany({
    where: { active: true, dueDay: { not: null } },
    include: {
      property: { select: { name: true, timezone: true } },
      executions: { select: { periodKey: true } },
    },
  });

  const rows: OverdueRecurringTask[] = [];
  for (const t of tasks) {
    const tz = t.property.timezone;
    const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
    const monthDays = today.daysInMonth ?? 31;
    // This month's occurrence (clamp the day-of-month to short months).
    const due = today
      .set({ day: Math.min(t.dueDay as number, monthDays) })
      .startOf("day");
    if (today <= due) continue; // not yet past this month's due day
    const periodKey = today.toFormat("yyyy-MM");
    if (t.executions.some((e) => e.periodKey === periodKey)) continue; // done this period
    // Skip tasks that didn't exist by this month's due date (not expected yet).
    if (DateTime.fromJSDate(t.createdAt, { zone: tz }) > due) continue;
    rows.push({
      taskId: t.id,
      title: t.title,
      propertyName: t.property.name,
      timezone: tz,
      dueISO: due.toFormat("yyyy-MM-dd"),
      daysOverdue: Math.round(today.diff(due, "days").days),
    });
  }
  rows.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || a.title.localeCompare(b.title),
  );
  return rows;
}
