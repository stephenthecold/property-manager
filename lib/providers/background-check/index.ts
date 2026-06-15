import { getEnv } from "@/lib/config/env";
import type { BackgroundCheckProvider } from "@/lib/providers/background-check/types";
import { StubBackgroundCheckProvider } from "@/lib/providers/background-check/stub";

export type {
  BackgroundCheckCandidate,
  BackgroundCheckDecision,
  BackgroundCheckProvider,
  BackgroundCheckRequest,
  BackgroundCheckResult,
} from "@/lib/providers/background-check/types";

let cached: BackgroundCheckProvider | null = null;

/** Returns the configured background-check provider (stub by default). */
export function getBackgroundCheckProvider(): BackgroundCheckProvider {
  if (cached) return cached;
  const provider = getEnv().BACKGROUND_CHECK_PROVIDER;
  if (provider === undefined || provider === "stub") {
    cached = new StubBackgroundCheckProvider();
    return cached;
  }
  throw new Error(
    `Unknown BACKGROUND_CHECK_PROVIDER ${JSON.stringify(provider)}; expected "stub" or unset.`,
  );
}

/** Test helper: clear the memoized provider so a new env can be re-read. */
export function resetBackgroundCheckProviderCache(): void {
  cached = null;
}
