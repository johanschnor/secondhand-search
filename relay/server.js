// API-relay til eBay, Tradera og Momox (hostes af projektets ejer, IKKE af brugeren)
//
// eBay, Tradera og Momox er officielle API'er, der kræver nøgler. Nøglerne må ikke ligge i et
// offentligt GitHub-repo, så den lokale app spørger denne relay i stedet. Relayen kører de
// samme services som den lokale app og returnerer resultaterne. Alt andet (Vinted, DBA osv.)
// scrapes stadig direkte fra brugerens egen IP og går aldrig forbi her.
//
// Deploy fx på Render:  root = secondhand-search,  build = npm install,  start = npm run relay
// Miljøvariabler:       EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, TRADERA_APP_ID, TRADERA_APP_KEY,
//                       CONSTRUCTOR_KEY  (+ valgfrit EBAY_CAMPAIGN_ID, AWIN_MID, AWIN_AFFID)

import dotenv from "dotenv";
import express from "express";

dotenv.config();
delete process.env.SCRAPERAPI_KEY;

const { ebayService, traderaService, momoxService } = await import("../src/services/index.js");

const SERVICES = { ebay: ["eBay", ebayService], tradera: ["Tradera", traderaService], momox: ["Momox", momoxService] };

// Simpel beskyttelse af nøglerne: max N forespørgsler pr. IP pr. minut
const RATE_LIMIT = Number(process.env.RELAY_RATE_LIMIT) || 60;
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();

const app = express();
app.set("trust proxy", true);

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/search", async (req, res) => {
  const ip = req.ip || "unknown";
  const count = (hits.get(ip) || 0) + 1;
  hits.set(ip, count);
  if (count > RATE_LIMIT) return res.status(429).json({ error: "For mange forespørgsler – prøv igen om et minut." });

  const entry = SERVICES[String(req.query.source || "").toLowerCase()];
  if (!entry) return res.status(400).json({ error: "source skal være eBay, Tradera eller Momox." });
  const [name, service] = entry;

  const q = String(req.query.q || "").trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: "Mangler søgeord." });

  const filters = {
    q,
    kon: String(req.query.kon || ""),
    kategori: String(req.query.kategori || ""),
    size: String(req.query.size || ""),
    brand: String(req.query.brand || ""),
    sortBy: String(req.query.sortBy || "newly_listed"),
    page: Math.min(parseInt(req.query.page, 10) || 1, 20),
    limit: Math.min(parseInt(req.query.limit, 10) || 24, 60),
    priceMin: null,
    priceMax: null,
  };

  try {
    const result = await service.search(q, filters);
    const items = (Array.isArray(result) ? result : result?.items || []).map((i) => ({ ...i, source: i.source || name }));
    res.json({ items });
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    res.status(502).json({ error: `${name} fejlede` });
  }
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => console.log(`Relay kører på port ${PORT}`));
