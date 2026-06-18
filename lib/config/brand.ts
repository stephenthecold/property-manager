/**
 * Brand colour → CSS-variable overrides. An operator picks one brand colour
 * (Settings → Organization); we take only its HUE and re-tint the theme's
 * brand variables, keeping each variable's shipped lightness/chroma exactly.
 *
 * Why hue-only: the light/dark palettes in app/globals.css chose their L/C for
 * legible contrast (text on buttons, focus rings, print). Rotating only the hue
 * preserves that contrast on BOTH themes — an operator can recolour the app
 * without anyone having to re-check accessibility. A near-grey colour has no
 * meaningful hue, so it's rejected (the shipped palette stays).
 *
 * Pure: no DOM, no DB. The emitted CSS overrides only `--primary`, `--ring`,
 * and their sidebar twins; `--primary-foreground` is untouched (its contrast is
 * unchanged because `--primary`'s lightness is unchanged).
 */

/** The brand variables, with each one's shipped lightness + chroma per theme. */
const BRAND_VARS = {
  light: [
    { name: "--primary", l: 0.45, c: 0.14 },
    { name: "--ring", l: 0.6, c: 0.1 },
    { name: "--sidebar-primary", l: 0.45, c: 0.14 },
    { name: "--sidebar-ring", l: 0.6, c: 0.1 },
  ],
  dark: [
    { name: "--primary", l: 0.75, c: 0.1 },
    { name: "--ring", l: 0.55, c: 0.06 },
    { name: "--sidebar-primary", l: 0.75, c: 0.1 },
    { name: "--sidebar-ring", l: 0.55, c: 0.06 },
  ],
} as const;

/** True for "#rgb" or "#rrggbb" (case-insensitive). */
export function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
}

const linearize = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/**
 * OKLCH hue (0–360°) of an sRGB hex, or null when the colour is invalid or so
 * desaturated that its hue is meaningless (chroma below a small threshold).
 * Uses Björn Ottosson's OKLab matrices.
 */
export function hexToOklchHue(hex: string): number | null {
  const rgb = hexToRgb01(hex);
  if (!rgb) return null;
  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.hypot(a, bb);
  if (chroma < 0.02) return null; // effectively grey — no brand hue

  const deg = (Math.atan2(bb, a) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360 * 10) / 10;
}

/**
 * The `<style>` body that re-tints the brand variables to `hex`'s hue, or null
 * when the colour can't be used (invalid / greyscale). Safe to inject verbatim
 * — the only interpolated value is a validated numeric hue.
 */
export function brandColorStyles(hex: string): string | null {
  const hue = hexToOklchHue(hex);
  if (hue == null) return null;
  const block = (vars: ReadonlyArray<{ name: string; l: number; c: number }>) =>
    vars.map((v) => `${v.name}: oklch(${v.l} ${v.c} ${hue});`).join(" ");
  return `:root { ${block(BRAND_VARS.light)} } .dark { ${block(BRAND_VARS.dark)} }`;
}
