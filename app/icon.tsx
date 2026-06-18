import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { getFileStorage } from "@/lib/providers/storage";
import { getAppSettings } from "@/lib/services/app-settings";
import { isValidHexColor, readableTextColor } from "@/lib/config/brand";

/**
 * Dynamic favicon: the uploaded business logo (Settings → Organization) when
 * one exists, else a branded letter tile. Satori can't rasterize WebP, so
 * those (and any load failure) fall back to the tile. app/favicon.ico remains
 * as the static fallback for old browsers.
 */

export const runtime = "nodejs";
// Reads the logo from DB+storage per request — never prerender at build
// (docker builds have no database; see CLAUDE.md).
export const dynamic = "force-dynamic";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

const SATORI_SAFE = new Set(["image/png", "image/jpeg"]);

export default async function Icon() {
  const app = await getAppSettings();

  let logoDataUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      const doc = await prisma.uploadedDocument.findUnique({
        where: { id: app.logoDocumentId },
      });
      if (doc && doc.fileType && SATORI_SAFE.has(doc.fileType)) {
        const bytes = await (await getFileStorage()).get(doc.fileUrl);
        logoDataUrl = `data:${doc.fileType};base64,${bytes.toString("base64")}`;
      }
    } catch {
      logoDataUrl = null;
    }
  }

  if (logoDataUrl) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
          }}
        >
          <img
            src={logoDataUrl}
            alt=""
            width={64}
            height={64}
            style={{ objectFit: "contain", borderRadius: 8 }}
          />
        </div>
      ),
      size,
    );
  }

  const initial = (app.businessName?.trim()?.[0] ?? "P").toUpperCase();
  // Tint the letter tile with the brand colour (contrast-correct letter), else
  // the default navy gradient.
  const brand =
    app.brandColor && isValidHexColor(app.brandColor) ? app.brandColor : null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          color: brand ? readableTextColor(brand) : "#f1f5f9",
          fontSize: 40,
          fontWeight: 700,
          background: brand ?? "linear-gradient(160deg, #31415e 0%, #1d2a45 100%)",
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
