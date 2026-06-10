import type {
  OcrExtraction,
  OcrInput,
  OcrProvider,
} from "@/lib/providers/ocr/types";

/**
 * Default OCR provider. Decodes plain-text inputs (text/* or .txt) verbatim so
 * the suggestion flow is testable end-to-end; for anything binary (images,
 * PDFs) it honestly reports an empty extraction rather than pretending to read
 * pixels.
 */
export class StubOcrProvider implements OcrProvider {
  readonly name = "stub";

  async extract(input: OcrInput): Promise<OcrExtraction> {
    const isPlainText =
      input.contentType?.toLowerCase().startsWith("text/") ||
      input.fileName?.toLowerCase().endsWith(".txt");
    if (!isPlainText) return { text: "", confidence: 0 };
    return { text: Buffer.from(input.body).toString("utf8"), confidence: 0.99 };
  }
}
