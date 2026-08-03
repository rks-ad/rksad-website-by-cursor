import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendOtp, verifyOtp, submitPartner } from "./routes/partner.js";
import { getAndIncrementCounter } from "./counter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve views/ whether running from src/ (tsx) or dist/ (compiled). */
function resolveViewsDir(): string {
  const candidates = [
    join(__dirname, "..", "views"),
    join(process.cwd(), "views"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0];
}

const viewsDir = resolveViewsDir();
const htmlContent = readFileSync(join(viewsDir, "index.html"), "utf-8");

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || "https://rks.ad").replace(/\/$/, "");

const app = new Hono();

// --- SEO ---
app.get("/sitemap.xml", (c) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `    <url>\n` +
    `        <loc>${SITE_URL}/</loc>\n` +
    `        <lastmod>${lastmod}</lastmod>\n` +
    `        <changefreq>daily</changefreq>\n` +
    `        <priority>1.0</priority>\n` +
    `    </url>\n` +
    `</urlset>`;
  return c.body(sitemap, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

app.get("/robots.txt", (c) => {
  return c.text(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /health",
      "",
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      "",
    ].join("\n"),
    200,
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    }
  );
});

// --- API ---
app.post("/api/send-otp", sendOtp);
app.post("/api/verify-otp", verifyOtp);
app.post("/api/submit-partner", submitPartner);

app.get("/api/counter", async (c) => {
  try {
    const count = await getAndIncrementCounter();
    return c.json({ count });
  } catch (err) {
    console.error("[counter] unexpected error:", err);
    // Last-resort: never break the page
    return c.json({ count: 0 });
  }
});

// --- Health (useful for Docker / Dokploy probes) ---
app.get("/health", (c) => {
  const key = process.env.RESEND_API_KEY?.trim() || "";
  const emailConfigured =
    Boolean(key) && !key.includes("xxxx") && key !== "re_xxxxxxxxxxxxxxxxxxxxxxxx";
  return c.json({
    ok: true,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    emailConfigured,
    fromEmail: process.env.FROM_EMAIL || "Notify@mails.rks.ad",
    partnerNotifyEmail: process.env.PARTNER_NOTIFY_EMAIL || "iam@rks.ad",
  });
});

// --- SPA / home ---
app.get("*", (c) => {
  return c.html(htmlContent, 200, {
    "Cache-Control": "public, max-age=30",
  });
});

console.log(`[rksad] listening on http://0.0.0.0:${PORT}`);
serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
