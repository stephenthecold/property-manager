import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The CSV / PDF / Excel export trio for a report card on /reports. Each is a
 * plain link to /api/reports/[type] with the matching ?format= (the route shares
 * one capability gate + one row builder across formats). Kept as a server
 * component (just links) so it composes into the server-rendered report cards.
 */
export function ReportExportButtons({ href }: { href: string }) {
  const withFormat = (format: "csv" | "pdf" | "xlsx") => {
    const sep = href.includes("?") ? "&" : "?";
    return `${href}${sep}format=${format}`;
  };
  return (
    <div className="flex items-center gap-2">
      <Button render={<Link href={withFormat("csv")} />} variant="outline" size="sm">
        CSV
      </Button>
      <Button render={<Link href={withFormat("pdf")} />} variant="outline" size="sm">
        PDF
      </Button>
      <Button render={<Link href={withFormat("xlsx")} />} variant="outline" size="sm">
        Excel
      </Button>
    </div>
  );
}
