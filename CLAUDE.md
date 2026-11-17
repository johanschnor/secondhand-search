# Secondhand-søgning (lokal)

En lokal side, der søger på tværs af secondhand-sider. Den kører udelukkende på brugerens egen maskine, og alle opslag går fra brugerens egen IP.

## Når brugeren beder om at starte siden

1. Tjek at Node.js ≥ 18 er installeret (`node -v`). Mangler det, så bed brugeren installere det fra nodejs.org.
2. Kør `npm install`, hvis `node_modules/` mangler.
3. Start serveren. I Claude desktop-appen: brug preview-konfigurationen `secondhand-search` i `.claude/launch.json`. Ellers: `npm start` i baggrunden.
4. Åbn http://localhost:4321.

Port 4321 kan ændres med `PORT=xxxx npm start`.

## Regler

- **Ingen proxy.** Opslag må ikke sendes gennem ScraperAPI eller andre tredjeparts-proxyer. `server.js` sletter `SCRAPERAPI_KEY` ved opstart, og det skal blive sådan.
- **Undtagelse: eBay, Tradera og Momox** er officielle API'er med nøgler. De går via projektets relay (`relay/server.js`, URL i `DEFAULT_RELAY_URL` / `RELAY_URL`), så nøglerne aldrig ligger i repoet. Læg aldrig API-nøgler i repoet.
- Zalando er fjernet (Akamai-botbeskyttelse kræver en rigtig browser).
- **Pil så lidt som muligt ved `src/services/*.js`.** De er håndtunede scrapere. Ret kun i dem, hvis en platform er gået i stykker (fx hvis siden har ændret sin HTML), og ret så kun det, der er nødvendigt.
- `src/controllers/categoryMap.js` og `sizeMap.js` er fælles sandhed for kategorier og størrelser. Frontenden henter dem via `/api/categories`, og services bruger dem til at slå platform-ID'er op. Nøglerne (fx `"Overtøj"`, `"M"`, `"42"`) skal derfor være de samme begge steder. Køn sendes som `Men` / `Female` (ikke `Women`, for services matcher på delstrengen "men").
- Serveren lytter kun på `127.0.0.1`.

## Fejlsøgning

- `npm test` (mens serveren kører) viser antal resultater pr. platform.
- Serverloggen viser de præcise URL'er, hver service kalder.
- En platform med 0 resultater på mange forskellige søgninger har typisk fået ny HTML. Sammenlign selectorerne i dens service med sidens nuværende markup.
