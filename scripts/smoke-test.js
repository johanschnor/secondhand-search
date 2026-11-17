// Kører en håndfuld søgninger mod den lokale server og viser antal resultater pr. platform.
// Start serveren først (npm start), kør derefter: npm test
const BASE = process.env.BASE_URL || "http://localhost:4321";

const cases = [
  { q: "carhartt jacket" },
  { q: "nike", kon: "Female", kategori: "Sko", size: "38" },
  { q: "ralph lauren", kon: "Men", kategori: "Skjorter", size: "M" },
  { q: "levis", kon: "Men", kategori: "Jeans" },
];

let failed = false;
try {
  const platforms = await (await fetch(`${BASE}/api/platforms`)).json();
  const cats = await (await fetch(`${BASE}/api/categories`)).json();
  console.log(`Platforme aktive: ${platforms.filter((p) => p.enabled).map((p) => p.name).join(", ")}`);
  console.log(`Kategorier: ${cats.categories.length} · størrelsestyper: ${Object.keys(cats.sizes).join(", ")}\n`);
} catch (e) {
  console.error(`Kan ikke nå ${BASE} – kører serveren? (npm start)`);
  process.exit(1);
}

for (const c of cases) {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/search?${new URLSearchParams(c)}`);
  const data = await res.json();
  const label = Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`${label}  →  ${data.total} resultater (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  for (const [name, s] of Object.entries(data.sources).sort()) {
    console.log(`   ${s.error ? "✗" : s.count ? "✓" : "·"} ${name.padEnd(24)} ${String(s.count).padStart(3)}${s.error ? "  " + s.error : ""}`);
  }
  if (!data.total) failed = true;
  console.log();
}
process.exit(failed ? 1 : 0);
