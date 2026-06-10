import { getEnv } from "@/lib/config/env";
import type { OcrProvider } from "@/lib/providers/ocr/types";
import { StubOcrProvider } from "@/lib/providers/ocr/stub";

export type {
  OcrExtraction,
  OcrInput,
  OcrProvider,
} from "@/lib/providers/ocr/types";

// `undefined` = not yet resolved; `null` = resolved as disabled.
let cached: OcrProvider | null | undefined;

/** Returns the configured OCR provider, or null when OCR is disabled. */
export function getOcrProvider(): OcrProvider | null {
  if (cached !== undefined) return cached;
  const env = getEnv();
  if (!env.OCR_ENABLED) {
    cached = null;
    return cached;
  }
  const provider = env.OCR_PROVIDER;
  if (provider === undefined || provider === "stub") {
    cached = new StubOcrProvider();
    return cached;
  }
  throw new Error(
    `Unknown OCR_PROVIDER ${JSON.stringify(provider)}; expected "stub" or unset.`,
  );
}

/** Test helper: clear the memoized provider so a new env can be re-read. */
export function resetOcrProviderCache(): void {
  cached = undefined;
}
