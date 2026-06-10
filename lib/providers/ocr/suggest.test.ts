import { describe, it, expect } from "vitest";
import { suggestFromOcrText } from "@/lib/providers/ocr/suggest";

describe("suggestFromOcrText / amounts", () => {
  it("picks the largest of multiple amounts on a realistic receipt", () => {
    const text = [
      "Maple Street Apartments",
      "Date: 2026-06-01",
      "Received of John Tenant",
      "Rent ............ $1,200.00",
      "Late fee ........... $50.00",
      "Total paid ...... $1,250.00",
      "Check #1052",
    ].join("\n");
    const s = suggestFromOcrText(text);
    expect(s.amountCents).toBe("125000");
    expect(s.paymentDate).toBe("2026-06-01");
    expect(s.referenceNumber).toBe("1052");
  });

  it("parses comma-thousands without a dollar sign", () => {
    const s = suggestFromOcrText("Amount paid 12,500.00 on 06/03/2026");
    expect(s.amountCents).toBe("1250000");
    expect(s.paymentDate).toBe("2026-06-03");
  });

  it("treats a dollar sign without decimals as currency", () => {
    expect(suggestFromOcrText("Paid $500 cash").amountCents).toBe("50000");
  });

  it("ignores bare integers that are not currency-looking", () => {
    expect(suggestFromOcrText("Unit 204, invoice 31337")).toEqual({});
  });

  it("prefers the largest amount across $ and bare tokens", () => {
    const s = suggestFromOcrText("Subtotal 1,150.00\nFee $75.25\nTotal $1,225.25");
    expect(s.amountCents).toBe("122525");
  });
});

describe("suggestFromOcrText / dates", () => {
  it("normalizes single-digit MM/DD/YYYY", () => {
    const s = suggestFromOcrText("Paid 6/3/2026 amount 750.00");
    expect(s.paymentDate).toBe("2026-06-03");
    expect(s.amountCents).toBe("75000");
  });

  it("takes the first date in text order across both formats", () => {
    const s = suggestFromOcrText("Paid 06/01/2026, deposited 2026-06-15.");
    expect(s.paymentDate).toBe("2026-06-01");
  });

  it("skips implausible dates and keeps scanning", () => {
    const s = suggestFromOcrText("Printed 99/99/2026, due 2026-07-01");
    expect(s.paymentDate).toBe("2026-07-01");
  });
});

describe("suggestFromOcrText / reference numbers", () => {
  it("extracts a check number", () => {
    expect(suggestFromOcrText("Payment by Check #2210").referenceNumber).toBe(
      "2210",
    );
  });

  it("extracts a hyphenated ref id", () => {
    expect(suggestFromOcrText("ref # AB-991").referenceNumber).toBe("AB-991");
  });

  it("matches the receipt keyword", () => {
    expect(suggestFromOcrText("Receipt # R-100").referenceNumber).toBe("R-100");
  });
});

describe("suggestFromOcrText / nothing found", () => {
  it("returns {} for empty text", () => {
    expect(suggestFromOcrText("")).toEqual({});
  });

  it("returns {} when no fields match, without throwing", () => {
    expect(suggestFromOcrText("thanks for stopping by!\n*** % @@ ::")).toEqual(
      {},
    );
  });
});
