import JSZip from "jszip";

/**
 * Fill `{{placeholder}}` tags in a .docx template (a ZIP of XML parts).
 *
 * Strategy:
 *  1. Collapse split runs. Word frequently fragments literal text like
 *     `{{rent}}` across several `<w:t>` runs (spell-check, formatting, or
 *     editing history). Within each `<w:p>` paragraph we join the text of all
 *     `<w:t>` elements, find placeholders that span runs, and rewrite the run
 *     containing the placeholder's opening braces to hold the whole tag while
 *     the spanned characters are removed from the following runs. This is a
 *     conservative, text-only rewrite — run properties/formatting are never
 *     touched. Placeholders typed with formatting changes *inside* the braces
 *     keep the formatting of the first run.
 *  2. Substitute. A single pass replaces `{{ key }}` (whitespace inside the
 *     braces allowed) with the XML-escaped value. UNKNOWN KEYS ARE LEFT
 *     INTACT so typos remain visible in the generated document instead of
 *     silently disappearing.
 *
 * Applies to word/document.xml and any word/headerN.xml / word/footerN.xml.
 */

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export { DOCX_CONTENT_TYPE };

/** Fresh regex per use — global regexes carry lastIndex state. */
const placeholderRe = () => /\{\{\s*(\w+)\s*\}\}/g;
const paragraphRe = () => /<w:p\b[\s\S]*?<\/w:p>/g;
const textRe = () => /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;

/** Escape a replacement value for insertion into XML text content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface TextSegment {
  /** Offsets of the whole <w:t>…</w:t> element within the paragraph. */
  start: number;
  end: number;
  open: string;
  text: string;
  close: string;
}

/**
 * Rewrite one paragraph so that every placeholder is contained in a single
 * <w:t> run: the run where the placeholder starts receives the full tag, the
 * spanned characters are removed from subsequent runs.
 */
function collapseParagraph(paragraph: string): string {
  const segments: TextSegment[] = [];
  const tRe = textRe();
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(paragraph))) {
    segments.push({
      start: tm.index,
      end: tm.index + tm[0].length,
      open: tm[1],
      text: tm[2],
      close: tm[3],
    });
  }
  if (segments.length < 2) return paragraph;

  const joined = segments.map((s) => s.text).join("");
  // Quick reject: no (possibly split) placeholder in this paragraph at all.
  if (!placeholderRe().test(joined)) return paragraph;

  // All placeholder matches in joined-text coordinates.
  const matches: { start: number; end: number; token: string }[] = [];
  const pRe = placeholderRe();
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(joined))) {
    matches.push({ start: pm.index, end: pm.index + pm[0].length, token: pm[0] });
  }

  // Re-emit each segment's text: characters inside a match are dropped except
  // at the match start, where the full token is emitted. Same-run matches
  // reproduce their input exactly; spanning matches collapse into one run.
  const inMatch = (pos: number) =>
    matches.find((m) => pos >= m.start && pos < m.end);

  let offset = 0;
  const newTexts = segments.map((seg) => {
    let out = "";
    for (let i = 0; i < seg.text.length; i++) {
      const pos = offset + i;
      const m = inMatch(pos);
      if (!m) {
        out += seg.text[i];
      } else if (pos === m.start) {
        out += m.token;
      }
      // Otherwise: a character covered by a match emitted elsewhere — drop it.
    }
    offset += seg.text.length;
    return out;
  });

  // Splice the rewritten texts back, preserving everything between segments.
  let result = "";
  let cursor = 0;
  segments.forEach((seg, i) => {
    result += paragraph.slice(cursor, seg.start);
    let open = seg.open;
    // An emptied/edited run may now begin or end with whitespace Word would
    // otherwise trim — pin it down.
    if (newTexts[i] !== seg.text && !open.includes("xml:space")) {
      open = open.replace(/>$/, ' xml:space="preserve">');
    }
    result += open + newTexts[i] + seg.close;
    cursor = seg.end;
  });
  result += paragraph.slice(cursor);
  return result;
}

/** Pass 1 over a whole XML part: collapse split-run placeholders per paragraph. */
export function collapseSplitPlaceholders(xml: string): string {
  return xml.replace(paragraphRe(), (paragraph) => collapseParagraph(paragraph));
}

/** Pass 2: replace known placeholders with XML-escaped values; leave unknown keys intact. */
export function substitutePlaceholders(
  xml: string,
  vars: Record<string, string>,
): string {
  return xml.replace(placeholderRe(), (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key)
      ? escapeXml(vars[key])
      : match,
  );
}

/**
 * Fill a .docx template's placeholders and return the rebuilt archive.
 * Throws when the buffer is not a valid .docx (unreadable ZIP or no
 * word/document.xml) — callers surface that as a returned error.
 */
export async function fillDocxTemplate(
  template: Buffer,
  vars: Record<string, string>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);

  const targets = Object.keys(zip.files).filter(
    (name) =>
      name === "word/document.xml" ||
      /^word\/(?:header|footer)\d*\.xml$/.test(name),
  );
  if (!targets.includes("word/document.xml")) {
    throw new Error("Not a .docx file (missing word/document.xml).");
  }

  for (const name of targets) {
    const xml = await zip.files[name].async("string");
    const filled = substitutePlaceholders(collapseSplitPlaceholders(xml), vars);
    if (filled !== xml) zip.file(name, filled);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}
