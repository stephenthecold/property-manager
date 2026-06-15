import { describe, expect, it } from "vitest";
import { classifyKeyword } from "./keywords";

describe("classifyKeyword", () => {
  it("recognizes opt-out keywords (case/punctuation tolerant)", () => {
    for (const w of ["STOP", "stop", "Stop.", "  STOP!", "unsubscribe", "CANCEL", "quit", "end", "optout"]) {
      expect(classifyKeyword(w)).toBe("stop");
    }
  });

  it("recognizes opt-in keywords", () => {
    for (const w of ["START", "start", "YES", "unstop", "subscribe"]) {
      expect(classifyKeyword(w)).toBe("start");
    }
  });

  it("recognizes help keywords", () => {
    for (const w of ["HELP", "help", "INFO", "Help?"]) {
      expect(classifyKeyword(w)).toBe("help");
    }
  });

  it("uses only the first word", () => {
    expect(classifyKeyword("STOP texting me please")).toBe("stop");
    expect(classifyKeyword("help me understand my balance")).toBe("help");
  });

  it("returns none for normal replies and empties", () => {
    for (const w of ["thanks!", "I'll pay tomorrow", "", "   ", null, undefined, "stopwatch"]) {
      expect(classifyKeyword(w)).toBe("none");
    }
  });
});
