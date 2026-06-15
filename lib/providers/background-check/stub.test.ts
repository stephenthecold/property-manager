import { describe, it, expect } from "vitest";
import { StubBackgroundCheckProvider } from "@/lib/providers/background-check/stub";
import type { BackgroundCheckCandidate } from "@/lib/providers/background-check/types";

const provider = new StubBackgroundCheckProvider();

function req(candidate: Partial<BackgroundCheckCandidate>, reference = "app_1") {
  return provider.request({
    reference,
    candidate: {
      firstName: candidate.firstName ?? "Jane",
      lastName: candidate.lastName ?? "Doe",
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
    },
  });
}

describe("StubBackgroundCheckProvider", () => {
  it("clears an ordinary candidate and echoes the reference as the external id", async () => {
    const r = await req({ firstName: "Jane", lastName: "Doe" }, "app_42");
    expect(r.status).toBe("clear");
    expect(r.externalId).toBe("stub_app_42");
    expect(r.reportUrl).toBeNull();
    expect(r.summary).toMatch(/stub/i);
  });

  it('returns "consider" when the candidate matches the consider keyword (case-insensitive)', async () => {
    const r = await req({ lastName: "Consider" });
    expect(r.status).toBe("consider");
    expect(r.externalId).toBe("stub_app_1");
  });

  it('returns "failed" with no external id on the fail keyword', async () => {
    const r = await req({ email: "fail@example.com" });
    expect(r.status).toBe("failed");
    expect(r.externalId).toBeNull();
  });

  it("is deterministic for the same input", async () => {
    const a = await req({ firstName: "Sam", lastName: "Smith" }, "ref_x");
    const b = await req({ firstName: "Sam", lastName: "Smith" }, "ref_x");
    expect(a).toEqual(b);
  });

  it("matches keywords across name and email fields", async () => {
    expect((await req({ firstName: "Considerate" })).status).toBe("consider");
    expect((await req({ email: "willfail@x.com" })).status).toBe("failed");
  });
});
