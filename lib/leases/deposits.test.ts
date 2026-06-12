import { describe, it, expect } from "vitest";
import { parseDepositRows } from "@/lib/leases/deposits";

describe("parseDepositRows", () => {
  it("empty or blank input means no additional deposits", () => {
    expect(parseDepositRows("")).toEqual({ deposits: [] });
    expect(parseDepositRows("   ")).toEqual({ deposits: [] });
    expect(parseDepositRows("[]")).toEqual({ deposits: [] });
  });

  it("parses valid rows into integer cents, trimming labels", () => {
    const result = parseDepositRows(
      JSON.stringify([
        { label: "  Pet deposit ", amount: "250.00", nonRefundable: true },
        { label: "Key deposit", amount: "75", nonRefundable: false },
      ]),
    );
    expect(result).toEqual({
      deposits: [
        { label: "Pet deposit", amountCents: 25000n, nonRefundable: true },
        { label: "Key deposit", amountCents: 7500n, nonRefundable: false },
      ],
    });
  });

  it("accepts human money formats ($, commas) via toCents", () => {
    const result = parseDepositRows(
      JSON.stringify([{ label: "Pet deposit", amount: "$1,250.50", nonRefundable: false }]),
    );
    expect(result).toEqual({
      deposits: [{ label: "Pet deposit", amountCents: 125050n, nonRefundable: false }],
    });
  });

  it("nonRefundable is only true for a literal boolean true", () => {
    const result = parseDepositRows(
      JSON.stringify([
        { label: "A", amount: "10", nonRefundable: "true" },
        { label: "B", amount: "10", nonRefundable: 1 },
        { label: "C", amount: "10" },
      ]),
    );
    expect(result).toEqual({
      deposits: [
        { label: "A", amountCents: 1000n, nonRefundable: false },
        { label: "B", amountCents: 1000n, nonRefundable: false },
        { label: "C", amountCents: 1000n, nonRefundable: false },
      ],
    });
  });

  it("rejects unparseable JSON and non-array payloads", () => {
    expect(parseDepositRows("{not json")).toHaveProperty("error");
    expect(parseDepositRows('{"label":"x"}')).toHaveProperty("error");
    expect(parseDepositRows('"hello"')).toHaveProperty("error");
  });

  it("rejects malformed rows, naming the row number", () => {
    expect(parseDepositRows(JSON.stringify([null]))).toEqual({
      error: "Additional deposit 1 is malformed — please re-enter it.",
    });
    expect(
      parseDepositRows(JSON.stringify([{ label: "ok", amount: "10" }, "oops"])),
    ).toEqual({
      error: "Additional deposit 2 is malformed — please re-enter it.",
    });
  });

  it("requires a non-empty label", () => {
    expect(parseDepositRows(JSON.stringify([{ label: "  ", amount: "10" }]))).toEqual({
      error: 'Additional deposit 1 needs a label (e.g. "Pet deposit").',
    });
    expect(parseDepositRows(JSON.stringify([{ amount: "10" }]))).toEqual({
      error: 'Additional deposit 1 needs a label (e.g. "Pet deposit").',
    });
  });

  it("requires an amount and rejects garbage money values", () => {
    expect(parseDepositRows(JSON.stringify([{ label: "Pet", amount: "" }]))).toEqual({
      error: 'Enter an amount for "Pet".',
    });
    expect(parseDepositRows(JSON.stringify([{ label: "Pet" }]))).toEqual({
      error: 'Enter an amount for "Pet".',
    });
    expect(
      parseDepositRows(JSON.stringify([{ label: "Pet", amount: "abc" }])),
    ).toEqual({
      error: 'The amount for "Pet" must be a dollar amount like 250 or 250.00.',
    });
    expect(
      parseDepositRows(JSON.stringify([{ label: "Pet", amount: "10.999" }])),
    ).toEqual({
      error: 'The amount for "Pet" must be a dollar amount like 250 or 250.00.',
    });
  });

  it("rejects zero and negative amounts", () => {
    expect(parseDepositRows(JSON.stringify([{ label: "Pet", amount: "0" }]))).toEqual({
      error: 'The amount for "Pet" must be greater than zero.',
    });
    expect(
      parseDepositRows(JSON.stringify([{ label: "Pet", amount: "-25.00" }])),
    ).toEqual({
      error: 'The amount for "Pet" must be greater than zero.',
    });
  });

  it("short-circuits on the first invalid row", () => {
    const result = parseDepositRows(
      JSON.stringify([
        { label: "Good", amount: "10" },
        { label: "", amount: "20" },
        { label: "Also bad", amount: "x" },
      ]),
    );
    expect(result).toEqual({
      error: 'Additional deposit 2 needs a label (e.g. "Pet deposit").',
    });
  });
});
