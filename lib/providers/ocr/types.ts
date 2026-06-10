/**
 * Swappable OCR provider (Phase 5, optional). The stub only decodes plain-text
 * inputs so the receipt-scanning flow is exercisable end-to-end without an OCR
 * engine; real providers (Tesseract, cloud OCR) slot in behind this interface.
 */
export interface OcrExtraction {
  text: string;
  /** 0..1; 0 means the provider could not read this input. */
  confidence: number;
}

export interface OcrInput {
  body: Buffer | Uint8Array;
  contentType?: string;
  fileName?: string;
}

export interface OcrProvider {
  readonly name: string;
  extract(input: OcrInput): Promise<OcrExtraction>;
}
