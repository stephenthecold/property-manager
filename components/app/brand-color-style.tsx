import { brandColorStyles } from "@/lib/config/brand";

/**
 * Injects the org brand-colour overrides as a <style> tag. Server component —
 * drop it inside a layout that already resolves AppSettings. Renders nothing
 * when no (usable) brand colour is configured, so the shipped theme stands.
 *
 * The CSS is generated from a validated colour (only a numeric hue is
 * interpolated), so dangerouslySetInnerHTML carries no injection risk and
 * avoids React escaping the `{}`/`:` in the stylesheet.
 */
export function BrandColorStyle({ color }: { color: string | null }) {
  const css = color ? brandColorStyles(color) : null;
  if (!css) return null;
  return <style data-brand-color dangerouslySetInnerHTML={{ __html: css }} />;
}
