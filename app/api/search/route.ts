import { authorizeApiCapability } from "@/lib/auth/session";
import {
  globalSearch,
  SEARCH_MAX_LEN,
  SEARCH_MIN_LEN,
} from "@/lib/services/search";

export const runtime = "nodejs";

/**
 * Global search (⌘K command palette). Read-only lookup over EXISTING operating
 * records (tenants/properties/units/leases/maintenance). Gated on
 * `tenants.manage`: the broad operational read/write capability all operational
 * staff (manager+) already hold — they can open every list this surfaces, and
 * the response carries no money/balance data, just names + deep links. We reuse
 * an existing capability rather than minting a new one (no read-only "view
 * records" cap exists, and a viewer has no operational record access today).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await authorizeApiCapability("tenants.manage");
  if (!auth.ok) {
    return Response.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status },
    );
  }

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const term = q.trim();
  // Out-of-bounds queries short-circuit to an empty result set (globalSearch
  // enforces the same bound, but we avoid touching the DB at all here).
  if (term.length < SEARCH_MIN_LEN || term.length > SEARCH_MAX_LEN) {
    return Response.json({ results: [] });
  }

  const results = await globalSearch(term);
  return Response.json({ results });
}
