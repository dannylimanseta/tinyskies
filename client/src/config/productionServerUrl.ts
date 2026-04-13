/**
 * Optional last-resort backend URL when both are missing:
 * - no `VITE_SERVER_URL` at build time (including `client/.env.production`), and
 * - `/api/server-url` returns empty (no SERVER_URL on Vercel).
 *
 * Set this **once** to your public game-server origin (https, no trailing slash)
 * if you prefer a single committed line over env files / Vercel settings.
 */
export const FALLBACK_PRODUCTION_SERVER_URL = "";
