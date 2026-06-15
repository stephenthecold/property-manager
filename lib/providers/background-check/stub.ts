import type {
  BackgroundCheckDecision,
  BackgroundCheckProvider,
  BackgroundCheckRequest,
  BackgroundCheckResult,
} from "@/lib/providers/background-check/types";

/**
 * Default background-check provider. Pulls NO real report — it returns a
 * deterministic, clearly-simulated decision so staff can exercise the request /
 * track flow without a paid FCRA integration.
 *
 * The outcome is keyword-driven (case-insensitive, matched against the
 * candidate's name + email) so QA can drive every branch on demand:
 *   - "consider" → consider (adverse-action review path)
 *   - "fail"     → failed   (provider-error path)
 *   - otherwise  → clear
 * Same input always yields the same result (no randomness).
 */
export class StubBackgroundCheckProvider implements BackgroundCheckProvider {
  readonly name = "stub";

  async request(req: BackgroundCheckRequest): Promise<BackgroundCheckResult> {
    const { candidate, reference } = req;
    const haystack = [candidate.firstName, candidate.lastName, candidate.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let status: BackgroundCheckDecision = "clear";
    if (haystack.includes("consider")) status = "consider";
    else if (haystack.includes("fail")) status = "failed";

    const summary =
      status === "clear"
        ? "Simulated screening: no records found (stub provider)."
        : status === "consider"
          ? "Simulated screening: records require manual review (stub provider)."
          : "Simulated screening: the provider could not complete the check (stub provider).";

    return {
      externalId: status === "failed" ? null : `stub_${reference}`,
      status,
      summary,
      reportUrl: null,
      raw: { provider: "stub", simulated: true, status },
    };
  }
}
