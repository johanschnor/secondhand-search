// Secondhand-søgning – søg på tværs af secondhand-sider (lokal udgave)
//
// Serveren kører på din egen computer, så alle opslag mod Vinted, DBA, Sellpy osv.
// går direkte fra din egen IP-adresse. Der er ingen central backend, proxy eller database.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env er valgfri (kun til platforme der kræver egne API-nøgler, se .env.example).
// Den skal indlæses FØR services importeres, da de læser process.env ved import.
dotenv.config({ path: path.join(__dirname, ".env") });

// Sikr at intet sendes gennem en tredjeparts-proxy: opslag skal gå via brugerens egen IP.
delete process.env.SCRAPERAPI_KEY;

const { allServices } = await import("./src/services/index.js");
const { CATEGORY_MAP } = await import("./src/controllers/categoryMap.js");
const { SIZE_MAP } = await import("./src/controllers/sizeMap.js");

// Samme auto-detect som backend/src/controllers/searchController.js:
// Sætter kategori ud fra søgeordet, så services kan slå de rigtige platform-ID'er op i CATEGORY_MAP.
function detectCategoryFromQuery(q) {
  if (!q) return "";
  const qLower = q.toLowerCase();
  if (qLower.match(/\b(t-shirt|t shirt|tshirt|tee)\b/)) return "T-shirts";
  if (qLower.match(/\b(hoodie|hættetrøje|sweatshirt)\b/)) return "Sweats";
  if (qLower.match(/\b(skjorte|skjorter|shirt|shirts|hemd|hemden)\b/)) return "Skjorter";
  if (qLower.match(/\b(jakke|frakke|coat|jacket|overtøj|outerwear)\b/)) return "Overtøj";
  if (qLower.match(/\b(taske|tasker|wallet|bag|bags|pung|backpack|tasche)\b/)) return "Tasker";
  if (qLower.match(/\b(sko|skor|sneaker|sneakers|boots|støvler|shoes|schuhe)\b/)) return "Sko";
  if (qLower.match(/\b(jeans)\b/)) return "Jeans";
  if (qLower.match(/\b(bukser|pants|trousers|hose)\b/)) return "Bukser";
  if (qLower.match(/\b(strik|knit|knitwear|sweater|pullover)\b/)) return "Strik";
  if (qLower.match(/\b(accessories|tilbehør|accessoarer)\b/)) return "Accessories";
  return "";
}

// Platforme der kun virker med egne API-nøgler i .env
const REQUIRED_KEYS = {
  eBay: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
  Tradera: ["TRADERA_APP_ID", "TRADERA_APP_KEY"],
  Momox: ["CONSTRUCTOR_KEY"],
};

const SOURCE_TIMEOUT_MS = 45_000;

// eBay, Tradera og Momox hentes via projektets relay (relay/server.js), som holder API-nøglerne.
// Sæt RELAY_URL i .env for at overskrive, eller til "off" for at slå relayen fra.
const DEFAULT_RELAY_URL = "https://secondhand-search-relay.onrender.com";
const RELAY_URL = (process.env.RELAY_URL ?? DEFAULT_RELAY_URL).replace(/\/+$/, "");
const RELAY_SOURCES = ["eBay", "Tradera", "Momox"];
const useRelay = (name) =>
  RELAY_URL && RELAY_URL !== "off" && RELAY_SOURCES.includes(name) && !hasLocalKeys(name);

const hasLocalKeys = (name) =>
  (REQUIRED_KEYS[name] || []).every((key) => Boolean(process.env[key]));
const isConfigured = (name) => hasLocalKeys(name) || useRelay(name);

const relaySearch = (name) => async (q, filters) => {
  const params = new URLSearchParams({ source: name, q });
  for (const k of ["kon", "kategori", "size", "brand", "sortBy", "page", "limit"]) {
    if (filters[k]) params.set(k, filters[k]);
  }
  const res = await fetch(`${RELAY_URL}/api/search?${params}`, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `relay svarede ${res.status}`);
  return data.items || [];
};
const runSearch = (name, service, q, filters) =>
  useRelay(name) ? relaySearch(name)(q, filters) : service.search(q, filters);

// Momox-links pakkes ind i et affiliate-link. Uden AWIN-id'er ville linket være dødt,
// så vi pakker det ud til det direkte produktlink.
const cleanUrl = (url) => {
  if (!url || !url.includes("awin1.com/cread.php")) return url;
  try {
    const u = new URL(url);
    if (u.searchParams.get("awinmid") && u.searchParams.get("awinmid") !== "undefined") return url;
    return u.searchParams.get("ued") || url;
  } catch {
    return url;
  }
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout efter ${ms / 1000}s`)), ms)),
  ]);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/platforms", (req, res) => {
  res.json(
    allServices.map(({ name }) => ({
      name,
      enabled: isConfigured(name),
      requires: isConfigured(name) ? [] : REQUIRED_KEYS[name] || [],
    }))
  );
});

// Kategorier og størrelser kommer direkte fra CATEGORY_MAP / SIZE_MAP, så frontenden
// altid sender præcis de nøgler services forventer (fx "Overtøj", "M", "42").
app.get("/api/categories", (req, res) => {
  const categories = Object.entries(CATEGORY_MAP)
    .filter(([name]) => name !== "Alle")
    .map(([name, c]) => ({
      name,
      label: c.translations?.dk || name,
      sizeType: c.sizeType || "clothing",
      // Kategorier uden herre-ID'er (fx Kjoler) giver kun mening for kvinder
      genders: ["male", "female"].filter((g) => Object.values(c[g] || {}).some(Boolean)),
    }));
  const sizes = Object.fromEntries(
    Object.entries(SIZE_MAP).map(([type, s]) => [type, Object.keys(s.values || {})])
  );
  res.json({ categories, sizes });
});

app.get("/api/search", async (req, res) => {
  const {
    q = "",
    sources,
    page = 1,
    limit = 24,
    priceMin,
    priceMax,
    sortBy = "newly_listed",
    kon,
    kategori,
    size,
    brand,
    condition,
  } = req.query;

  const filters = {
    q: String(q).trim(),
    priceMin: priceMin ? parseFloat(priceMin) : null,
    priceMax: priceMax ? parseFloat(priceMax) : null,
    sortBy: String(sortBy),
    kon: kon ? String(kon) : "",
    kategori: kategori ? String(kategori) : "",
    size: size ? String(size) : "",
    brand: brand ? String(brand) : "",
    condition: condition ? String(condition) : "",
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 24,
  };

  if (!filters.q && !filters.brand) {
    return res.status(400).json({ error: "Skriv et søgeord." });
  }

  if (!filters.kategori) filters.kategori = detectCategoryFromQuery(filters.q);

  let selected = allServices.filter(({ name }) => isConfigured(name));
  if (sources) {
    const wanted = String(sources).toLowerCase().split(",").map((s) => s.trim());
    selected = selected.filter(({ name }) => wanted.includes(name.toLowerCase()));
  }

  const perSource = {};
  const results = await Promise.all(
    selected.map(async ({ name, service }) => {
      const started = Date.now();
      try {
        const result = await withTimeout(runSearch(name, service, filters.q, filters), SOURCE_TIMEOUT_MS);
        const items = (Array.isArray(result) ? result : result?.items || [])
          .filter(Boolean)
          .map((item) => ({ ...item, source: item.source || name, url: cleanUrl(item.url) }));
        perSource[name] = { count: items.length, ms: Date.now() - started };
        return items;
      } catch (err) {
        perSource[name] = { count: 0, ms: Date.now() - started, error: err.message };
        console.error(`❌ ${name}: ${err.message}`);
        return [];
      }
    })
  );

  let items = results.flat();
  if (filters.priceMin !== null) items = items.filter((i) => (i.price || 0) >= filters.priceMin);
  if (filters.priceMax !== null) items = items.filter((i) => (i.price || 0) <= filters.priceMax);

  res.json({ items, total: items.length, page: filters.page, sources: perSource });
});

const PORT = Number(process.env.PORT) || 4321;
// Kun tilgængelig fra din egen maskine
app.listen(PORT, "127.0.0.1", () => {
  const active = allServices.filter(({ name }) => isConfigured(name)).map(({ name }) => name);
  console.log(`\n🔎 Secondhand-søgning kører på http://localhost:${PORT}`);
  console.log(`   Aktive platforme: ${active.join(", ")}`);
  console.log(`   Alle opslag går direkte fra din egen IP.\n`);
});
