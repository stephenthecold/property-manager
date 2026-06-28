import fs from "node:fs";
import path from "node:path";
import { asOfStamp, columnLabel, isMoneyColumn } from "@/lib/services/report-registry";
import type { ReportData } from "@/lib/services/report-registry";

/**
 * Format renderers for a portfolio report: HTML (the print view), PDF (headless
 * Chromium via Playwright), and Excel (.xlsx via exceljs). All consume the same
 * { headers, rows } produced by the report registry, so the column set and money
 * formatting are identical across CSV/PDF/Excel. Money cells are already decimal
 * strings from lib/services/reports (cents → display via lib/money); here we only
 * prefix "$" for money columns and right-align them.
 */

export type ExportFormat = "csv" | "pdf" | "xlsx";

export function isExportFormat(value: string): value is ExportFormat {
  return value === "csv" || value === "pdf" || value === "xlsx";
}

/** Browser-correct MIME + extension per format (used by the route + email). */
export const FORMAT_META: Record<
  ExportFormat,
  { mime: string; ext: string }
> = {
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
  pdf: { mime: "application/pdf", ext: "pdf" },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
};

/** A money cell already holds a decimal string ("-50.00"); display with "$". */
function displayCell(key: string, value: string): string {
  if (!isMoneyColumn(key)) return value;
  // A negative becomes "-$50.00" (credit); blank stays blank.
  if (value === "") return "";
  return value.startsWith("-") ? `-$${value.slice(1)}` : `$${value}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReportHtmlOptions {
  /** Report title (from the registry). */
  title: string;
  /** Org / business name for the header band. */
  businessName: string;
  /** Optional free-text header block (AppSettings.reportHeaderText). */
  headerText?: string | null;
  now: Date;
}

/**
 * A clean, print-oriented HTML document for a report. Self-contained (inline
 * styles, no external assets) so headless Chromium can render it from a string.
 * Always light/print colors — matches the app's "print forces light" rule.
 */
export function reportHtml(data: ReportData, opts: ReportHtmlOptions): string {
  const moneyKeys = new Set(data.headers.filter((h) => isMoneyColumn(h)));
  const thead = data.headers
    .map(
      (h) =>
        `<th class="${moneyKeys.has(h) ? "num" : ""}">${escapeHtml(columnLabel(h))}</th>`,
    )
    .join("");
  const tbody = data.rows.length
    ? data.rows
        .map((row) => {
          const tds = data.headers
            .map((h) => {
              const cell = displayCell(h, row[h] ?? "");
              return `<td class="${moneyKeys.has(h) ? "num" : ""}">${escapeHtml(cell)}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("")
    : `<tr><td class="empty" colspan="${data.headers.length}">No rows.</td></tr>`;

  const headerBlock = opts.headerText?.trim()
    ? `<p class="note">${escapeHtml(opts.headerText.trim()).replace(/\n/g, "<br>")}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    background: #ffffff;
    font-size: 12px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 32px 36px; }
  header { border-bottom: 2px solid #0ea5e9; padding-bottom: 10px; margin-bottom: 16px; }
  .brand { font-size: 13px; font-weight: 600; color: #0369a1; letter-spacing: .02em; }
  h1 { font-size: 20px; margin: 4px 0 2px; }
  .meta { font-size: 11px; color: #64748b; }
  .note { font-size: 11px; color: #475569; white-space: pre-line; margin: 8px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: #475569;
    background: #f1f5f9;
    border-bottom: 1px solid #cbd5e1;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #94a3b8; padding: 20px; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  footer { margin-top: 18px; font-size: 10px; color: #94a3b8; }
  @page { margin: 14mm; }
</style>
</head>
<body>
  <div class="page">
    <header>
      <div class="brand">${escapeHtml(opts.businessName)}</div>
      <h1>${escapeHtml(opts.title)}</h1>
      <div class="meta">Generated ${escapeHtml(asOfStamp(opts.now))} · ${data.rows.length} row${data.rows.length === 1 ? "" : "s"}</div>
      ${headerBlock}
    </header>
    <table>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
    <footer>${escapeHtml(opts.businessName)} — ${escapeHtml(opts.title)}</footer>
  </div>
</body>
</html>`;
}

/**
 * Resolve the Chromium executable for headless PDF. `playwright-core` ships NO
 * bundled browser, so an explicit binary path is required. Resolution order:
 *   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH / CHROMIUM_EXECUTABLE_PATH (explicit
 *      deploy override — point at a known system Chromium),
 *   2. a Chromium under PLAYWRIGHT_BROWSERS_PATH (the standard install dir),
 * Returns null when none is found so the caller can fail with a clear message
 * instead of a confusing launch error.
 */
function chromiumExecutablePath(): string | null {
  const explicit =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit) return explicit;

  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base) {
    // Match the newest chromium-<rev> dir's platform binary.
    try {
      const dirs = fs
        .readdirSync(base)
        .filter((d) => d.startsWith("chromium-"))
        .sort()
        .reverse();
      for (const d of dirs) {
        for (const rel of [
          ["chrome-linux", "chrome"],
          ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
          ["chrome-win", "chrome.exe"],
        ]) {
          const candidate = path.join(base, d, ...rel);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // fall through to null
    }
  }
  return null;
}

/**
 * Render report HTML to a PDF buffer with headless Chromium (playwright-core,
 * driving a system/preinstalled browser via executablePath — no bundled
 * browser, no `playwright install`). The import is dynamic so the browser engine
 * is only loaded when a PDF is actually requested — CSV/Excel paths and the rest
 * of the app never pull it in.
 */
export async function renderReportPdf(
  data: ReportData,
  opts: ReportHtmlOptions,
): Promise<Buffer> {
  const executablePath = chromiumExecutablePath();
  if (!executablePath) {
    throw new Error(
      "PDF export needs a Chromium binary — set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH " +
        "(or PLAYWRIGHT_BROWSERS_PATH to an installed Chromium).",
    );
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(reportHtml(data, opts), { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Render report rows to an .xlsx workbook buffer (exceljs). One sheet, a bold
 * header row, money columns right-aligned with a thousands/2dp number format and
 * parsed back to real numbers so spreadsheet math works (the decimal string is
 * authoritative; this is a display convenience only). Dynamic import keeps
 * exceljs out of the bundle until an Excel export is requested.
 */
export async function renderReportXlsx(
  data: ReportData,
  opts: ReportHtmlOptions,
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.businessName;
  wb.created = opts.now;
  // Sheet names are capped at 31 chars and cannot contain []*/\?:
  const sheetName = opts.title.replace(/[[\]*/\\?:]/g, " ").slice(0, 31) || "Report";
  const ws = wb.addWorksheet(sheetName);

  ws.columns = data.headers.map((h) => ({
    header: columnLabel(h),
    key: h,
    width: isMoneyColumn(h) ? 16 : Math.max(12, columnLabel(h).length + 2),
    style: isMoneyColumn(h)
      ? { numFmt: "#,##0.00", alignment: { horizontal: "right" } }
      : {},
  }));

  for (const row of data.rows) {
    const values: Record<string, string | number> = {};
    for (const h of data.headers) {
      const raw = row[h] ?? "";
      if (isMoneyColumn(h)) {
        // Keep an empty money cell empty; otherwise a real number for math.
        const n = raw === "" ? NaN : Number(raw);
        values[h] = Number.isFinite(n) ? n : raw;
      } else {
        values[h] = raw;
      }
    }
    ws.addRow(values);
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  // exceljs returns an ArrayBuffer-ish; coerce to a Node Buffer for callers.
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
