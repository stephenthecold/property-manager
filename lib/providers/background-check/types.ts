/**
 * Swappable tenant-screening / background-check provider (optional seam).
 *
 * Real consumer-reporting providers (Checkr, TransUnion SmartMove, etc.) are
 * asynchronous and FCRA-regulated: you submit a candidate, get a reference id
 * back, and the decision arrives later via webhook/poll. This interface models
 * that — `request()` may return a terminal decision immediately (the stub does,
 * so the flow is exercisable end-to-end) OR `pending`, with the result recorded
 * later through `lib/services/background-check.ts`. No provider here pulls a
 * real report; a live integration drops in behind this interface with creds.
 */

/** Normalized outcome, independent of any one vendor's vocabulary. */
export type BackgroundCheckDecision = "pending" | "clear" | "consider" | "failed";

export interface BackgroundCheckCandidate {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface BackgroundCheckRequest {
  candidate: BackgroundCheckCandidate;
  /** Our internal application id, echoed to the provider for correlation. */
  reference: string;
}

export interface BackgroundCheckResult {
  /** Provider's own reference id for this screening, when issued. */
  externalId: string | null;
  status: BackgroundCheckDecision;
  /** Short human-readable summary of the finding (no raw PII). */
  summary: string | null;
  /** Link to the provider-hosted report, when one exists. */
  reportUrl: string | null;
  /** Raw normalized payload, retained for the audit/result record. */
  raw?: unknown;
}

export interface BackgroundCheckProvider {
  readonly name: string;
  request(req: BackgroundCheckRequest): Promise<BackgroundCheckResult>;
}
