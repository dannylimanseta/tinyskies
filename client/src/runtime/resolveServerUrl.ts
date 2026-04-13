/**
 * Resolves the game API / Socket.io base URL.
 *
 * Order (first win):
 * 1. `VITE_SERVER_URL` at build time — easiest: put it in `client/.env.production` and commit (public URL).
 * 2. Same-origin `GET /api/server-url` (Vercel `SERVER_URL` / `VITE_SERVER_URL` — change URL without rebuilding).
 * 3. `FALLBACK_PRODUCTION_SERVER_URL` in `src/config/productionServerUrl.ts` (optional one-line default).
 * 4. Local dev: `http://localhost:3001`
 */

import { FALLBACK_PRODUCTION_SERVER_URL } from "../config/productionServerUrl";

const LOCAL_DEFAULT = "http://localhost:3001";

let cache: string | null = null;

function stripSlash(u: string) {
  return u.replace(/\/$/, "");
}

export async function resolveServerUrl(): Promise<string> {
  if (cache) return cache;

  const envUrl =
    typeof import.meta.env !== "undefined" && import.meta.env.VITE_SERVER_URL
      ? String(import.meta.env.VITE_SERVER_URL).trim()
      : "";
  if (envUrl) {
    cache = stripSlash(envUrl);
    return cache;
  }

  try {
    const r = await fetch("/api/server-url", { cache: "no-store" });
    if (r.ok) {
      const data = (await r.json()) as { serverUrl?: string };
      const u = data.serverUrl?.trim();
      if (u) {
        cache = stripSlash(u);
        return cache;
      }
    }
  } catch {
    // Vite dev: no `/api/server-url` — fall through.
  }

  if (import.meta.env.PROD) {
    const fb = FALLBACK_PRODUCTION_SERVER_URL.trim();
    if (fb) {
      cache = stripSlash(fb);
      return cache;
    }
  }

  cache = LOCAL_DEFAULT;
  return cache;
}

/** Clear cache (tests / hot reload). */
export function clearServerUrlCache() {
  cache = null;
}
