/**
 * Vercel serverless: returns backend URL for the browser (Socket.io + REST).
 * Set SERVER_URL or VITE_SERVER_URL in Vercel → Environment Variables (Production).
 * No rebuild required when the URL changes.
 */
module.exports = (req, res) => {
  const raw = process.env.SERVER_URL || process.env.VITE_SERVER_URL || "";
  const serverUrl = String(raw).trim().replace(/\/$/, "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ serverUrl });
};
