import type { VendorTrade } from "@/lib/generated/prisma/enums";

/**
 * Pure helpers for vendor trades (the directory of contractors/service
 * providers). Display / parse only; DB-free and unit-tested. A vendor never
 * touches the ledger.
 */

export const VENDOR_TRADES: VendorTrade[] = [
  "general",
  "plumbing",
  "electrical",
  "hvac",
  "landscaping",
  "cleaning",
  "appliance",
  "pest_control",
  "roofing",
  "other",
];

const LABELS: Record<VendorTrade, string> = {
  general: "General / handyman",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  landscaping: "Landscaping",
  cleaning: "Cleaning",
  appliance: "Appliance repair",
  pest_control: "Pest control",
  roofing: "Roofing",
  other: "Other",
};

export function isVendorTrade(value: string): value is VendorTrade {
  return (VENDOR_TRADES as readonly string[]).includes(value);
}

export function parseVendorTrade(
  raw: string | null | undefined,
  fallback: VendorTrade = "general",
): VendorTrade {
  return raw != null && isVendorTrade(raw) ? raw : fallback;
}

export function vendorTradeLabel(t: VendorTrade): string {
  return LABELS[t];
}
