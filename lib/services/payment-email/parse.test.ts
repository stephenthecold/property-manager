import { describe, expect, it } from "vitest";
import {
  parsePaymentEmail,
  paymentLineKey,
} from "@/lib/services/payment-email/parse";

const PAYPAL_BODY = `Hello, Derek Denney

Ronnie Conner sent you $625.00 USD

Amount

$625.00 USD

Transaction date

May 1, 2026

Transaction ID

1ED77809ER805621X

Smart money tip
Now use your balance in stores with PayPal Debit.`;

const CASHAPP_BODY = `John Rich

Today

For Toward July rent

+$100.00

Transaction details

Complete

Payment received

Payment between

Recipient: Derek Denney
Sender: John Rich

Deposited to

Cash balance

Transaction number

#D-VRK42VMR2

Open this receipt in Cash App

For any issues, including the recipient not receiving funds, please contact us at support or you can reach Cash App Support by calling 1 (800) 969-1940 .`;

const CASHAPP_BODY_2 = `James

Today

For rent deposit

+$850.00

Payment between

Recipient: Derek Denney
Sender: James

Transaction number

#D-MJZ6J6RKD`;

const BLACKBAUD_BODY = `blackbaud

Please confirm receipt of this deposit with your bank.

Invoice number
Payment amount
Payment date

RoseT070126R
$262.50
06/26/2026

ParsonsC070126R
$450.00
06/26/2026

WinsettK070126R
$425.00
06/26/2026

© 2026 Blackbaud, Inc.`;

describe("parsePaymentEmail — PayPal", () => {
  const r = parsePaymentEmail({
    fromEmail: "service@paypal.com",
    subject: "Ronnie Conner sent you $625.00 USD",
    body: PAYPAL_BODY,
  });
  it("detects provider + maps method", () => {
    expect(r.provider).toBe("paypal");
    expect(r.method).toBe("online");
  });
  it("extracts one line: amount, payer, date, reference", () => {
    expect(r.lines).toHaveLength(1);
    const l = r.lines[0];
    expect(l.amountCents).toBe(62500n);
    expect(l.payerName).toBe("Ronnie Conner");
    expect(l.reference).toBe("1ED77809ER805621X");
    expect(l.paymentDate).not.toBeNull();
    expect(l.paymentDate?.getFullYear()).toBe(2026);
  });
});

describe("parsePaymentEmail — Cash App", () => {
  it("extracts amount, sender, memo, reference (date is 'Today' → null)", () => {
    const r = parsePaymentEmail({
      fromEmail: "cash@square.com",
      subject: "Payment received",
      body: CASHAPP_BODY,
    });
    expect(r.provider).toBe("cashapp");
    expect(r.method).toBe("cash_app");
    expect(r.lines).toHaveLength(1);
    const l = r.lines[0];
    expect(l.amountCents).toBe(10000n);
    expect(l.payerName).toBe("John Rich");
    expect(l.memo).toBe("Toward July rent");
    expect(l.reference).toBe("D-VRK42VMR2");
    expect(l.paymentDate).toBeNull();
  });

  it("handles a first-name-only sender + different memo", () => {
    const r = parsePaymentEmail({
      fromEmail: "cash@square.com",
      subject: "Payment received",
      body: CASHAPP_BODY_2,
    });
    expect(r.lines[0].amountCents).toBe(85000n);
    expect(r.lines[0].payerName).toBe("James");
    expect(r.lines[0].memo).toBe("rent deposit");
    expect(r.lines[0].reference).toBe("D-MJZ6J6RKD");
  });

  it("does NOT pick up the boilerplate 'For any issues…' line as the memo", () => {
    const r = parsePaymentEmail({
      fromEmail: "cash@square.com",
      subject: "Payment received",
      body: CASHAPP_BODY,
    });
    expect(r.lines[0].memo).not.toMatch(/any issues/i);
  });
});

describe("parsePaymentEmail — Blackbaud (multi-row table)", () => {
  const r = parsePaymentEmail({
    fromEmail: "noreply@notification.blackbaud.com",
    subject: "You have received a payment from Kentucky River Foothills",
    body: BLACKBAUD_BODY,
  });
  it("yields one line per table row with amount + invoice + date", () => {
    expect(r.provider).toBe("blackbaud");
    expect(r.method).toBe("ach");
    expect(r.lines).toHaveLength(3);
    expect(r.lines.map((l) => l.amountCents)).toEqual([26250n, 45000n, 42500n]);
    expect(r.lines.map((l) => l.reference)).toEqual([
      "RoseT070126R",
      "ParsonsC070126R",
      "WinsettK070126R",
    ]);
    expect(r.lines.every((l) => l.paymentDate?.getFullYear() === 2026)).toBe(true);
  });
  it("does not treat the header row as a payment", () => {
    // 3 data rows only — "Payment amount" header has no $ and isn't counted.
    expect(r.lines).toHaveLength(3);
  });
});

describe("parsePaymentEmail — non-payment / unknown", () => {
  it("returns no lines for an unrelated sender", () => {
    const r = parsePaymentEmail({
      fromEmail: "invoices@acme.com",
      subject: "Invoice #42",
      body: "Please find attached invoice for $500.00.",
    });
    expect(r.provider).toBe("unknown");
    expect(r.lines).toHaveLength(0);
  });
});

describe("paymentLineKey", () => {
  it("uses a sanitized reference when present, else a positional key", () => {
    expect(
      paymentLineKey(
        { amountCents: 1n, payerName: null, paymentDate: null, reference: "#D-VRK42VMR2", memo: null },
        0,
      ),
    ).toBe("DVRK42VMR2");
    expect(
      paymentLineKey(
        { amountCents: 1n, payerName: null, paymentDate: null, reference: null, memo: null },
        2,
      ),
    ).toBe("idx2");
  });
});
