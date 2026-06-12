/**
 * Final signed-agreement artifact: a single self-contained HTML file stored as
 * an UploadedDocument when every signer has signed. Pure string rendering —
 * no DB, no clock, no external resources (drawn signatures are embedded as
 * data URLs). EVERY interpolated value goes through escapeHtml so tenant- or
 * operator-supplied text (including the agreement body) can never inject
 * markup into the evidence document.
 */

export interface ArtifactLandlord {
  name: string;
  signedAtISO: string;
  /** data:image/png;base64,... when a drawn signature image exists. */
  signatureImageDataUrl?: string;
}

export interface ArtifactSigner {
  name: string;
  signedAtISO: string;
  kind: "typed" | "drawn";
  signatureText?: string;
  signatureImageDataUrl?: string;
  ip?: string;
}

export interface SignedArtifactInput {
  documentText: string;
  documentSha256: string;
  businessName: string;
  /** e.g. "Unit 2B — Jane Doe" — shown in the header and evidence footer. */
  leaseLabel: string;
  landlord: ArtifactLandlord;
  signers: ArtifactSigner[];
  completedAtISO: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * True when the buffer starts with the PNG magic bytes. Uploaded signature
 * images are stored and re-served with an image/png content type, so reject
 * arbitrary bytes wearing a data:image/png prefix.
 */
export function looksLikePng(buf: Buffer): boolean {
  return buf.byteLength > PNG_MAGIC.byteLength && buf.subarray(0, 8).equals(PNG_MAGIC);
}

/** Cursive-styled typed signature or an embedded drawn-signature image. */
function signatureMark(s: {
  kind: "typed" | "drawn";
  signatureText?: string;
  signatureImageDataUrl?: string;
  fallbackName: string;
}): string {
  if (s.kind === "drawn" && s.signatureImageDataUrl) {
    return `<img class="sig-img" src="${escapeHtml(s.signatureImageDataUrl)}" alt="Drawn signature" />`;
  }
  return `<div class="sig-typed">${escapeHtml(s.signatureText?.trim() || s.fallbackName)}</div>`;
}

function signatureBlock(opts: {
  role: string;
  name: string;
  signedAtISO: string;
  mark: string;
  meta: string[];
}): string {
  const meta = opts.meta
    .filter(Boolean)
    .map((m) => `<div class="sig-meta">${escapeHtml(m)}</div>`)
    .join("");
  return `<div class="sig-block">
  <div class="sig-role">${escapeHtml(opts.role)}</div>
  ${opts.mark}
  <div class="sig-name">${escapeHtml(opts.name)}</div>
  <div class="sig-meta">Signed ${escapeHtml(opts.signedAtISO)}</div>
  ${meta}
</div>`;
}

export function renderSignedArtifactHtml(input: SignedArtifactInput): string {
  const landlordBlock = signatureBlock({
    role: "Landlord",
    name: input.landlord.name,
    signedAtISO: input.landlord.signedAtISO,
    mark: signatureMark({
      kind: input.landlord.signatureImageDataUrl ? "drawn" : "typed",
      signatureText: input.landlord.name,
      signatureImageDataUrl: input.landlord.signatureImageDataUrl,
      fallbackName: input.landlord.name,
    }),
    meta: [],
  });

  const signerBlocks = input.signers
    .map((s, i) =>
      signatureBlock({
        role: i === 0 ? "Tenant" : "Co-tenant",
        name: s.name,
        signedAtISO: s.signedAtISO,
        mark: signatureMark({ ...s, fallbackName: s.name }),
        meta: [s.ip ? `IP ${s.ip}` : ""],
      }),
    )
    .join("\n");

  const evidenceRows = [
    ["Document SHA-256", input.documentSha256],
    ["Completed", input.completedAtISO],
    ["Landlord signed", input.landlord.signedAtISO],
    ...input.signers.map((s): [string, string] => [
      `${s.name} signed`,
      `${s.signedAtISO}${s.ip ? ` from IP ${s.ip}` : ""} (${s.kind})`,
    ]),
  ]
    .map(
      ([k, v]) =>
        `<tr><td class="ev-key">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signed agreement — ${escapeHtml(input.leaseLabel)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1a202c; background: #fff;
         max-width: 48rem; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.55; }
  header { text-align: center; border-bottom: 2px solid #1a202c; padding-bottom: 1rem; margin-bottom: 1.5rem; }
  header h1 { font-size: 1.15rem; letter-spacing: 0.06em; text-transform: uppercase; margin: 0.25rem 0 0; }
  .business { font-size: 1rem; font-weight: bold; }
  .lease-label { color: #4a5568; font-size: 0.9rem; }
  .doc-text { white-space: pre-wrap; font-size: 0.95rem; }
  .sigs { margin-top: 2.5rem; border-top: 1px solid #cbd5e0; padding-top: 1rem; }
  .sigs h2, .evidence h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #4a5568; }
  .sig-block { margin: 1.25rem 0; padding-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; }
  .sig-role { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #718096; }
  .sig-typed { font-family: "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive;
               font-style: italic; font-size: 1.6rem; margin: 0.25rem 0; }
  .sig-img { display: block; max-height: 80px; max-width: 320px; margin: 0.25rem 0; }
  .sig-name { font-weight: bold; font-size: 0.95rem; }
  .sig-meta { font-size: 0.78rem; color: #4a5568; }
  .evidence { margin-top: 2.5rem; border-top: 2px solid #1a202c; padding-top: 1rem; }
  .evidence table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  .evidence td { padding: 0.25rem 0.5rem 0.25rem 0; vertical-align: top; border-bottom: 1px solid #e2e8f0; }
  .ev-key { color: #4a5568; white-space: nowrap; width: 1%; }
  .ev-note { font-size: 0.72rem; color: #718096; margin-top: 0.75rem; }
</style>
</head>
<body>
<header>
  <div class="business">${escapeHtml(input.businessName)}</div>
  <h1>Signed lease agreement</h1>
  <div class="lease-label">${escapeHtml(input.leaseLabel)}</div>
</header>
<section class="doc-text">${escapeHtml(input.documentText)}</section>
<section class="sigs">
  <h2>Signatures</h2>
  ${landlordBlock}
  ${signerBlocks}
</section>
<section class="evidence">
  <h2>Signing evidence</h2>
  <table>
${evidenceRows}
  </table>
  <p class="ev-note">All parties signed electronically. The SHA-256 digest above was computed
over the agreement text exactly as shown when the signing request was sent; any alteration
of the text changes the digest.</p>
</section>
</body>
</html>
`;
}
