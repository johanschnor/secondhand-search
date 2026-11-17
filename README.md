# Secondhand-søgning

En lille lokal side, der søger på én gang på Vinted, DBA, Sellpy, Grailed, Vestiaire, Kleinanzeigen, Marrkt, Second Football Shirts og Supersælger.

Den kører **på din egen computer**. Alle opslag sendes direkte fra din egen internetforbindelse (din egen IP) til de enkelte sider. Der er ingen central server, ingen proxy, ingen database, ingen konto og ingen tracking.

## Start med Claude

Download eller klon mappen, åbn den i Claude Code (desktop-appen eller terminalen) og skriv:

> Start secondhand-søgningen

Claude læser `CLAUDE.md`, installerer det nødvendige og åbner siden på http://localhost:4321.

## Start selv

Kræver [Node.js](https://nodejs.org) 18 eller nyere.

```bash
npm install
npm start
```

Åbn derefter http://localhost:4321.

## Filtre

- **Køn, kategori og størrelse** sendes videre til hver platform og oversættes til platformens egne kategori- og størrelses-ID'er via `src/controllers/categoryMap.js` og `src/controllers/sizeMap.js`. Vælger du ingen kategori, gætter siden den ud fra søgeordet (fx "jacket" → Overtøj).
- **Pris og sortering** sker lokalt i browseren, efter alle priser er omregnet til DKK.
- **Platforme** kan slås til og fra. Valget huskes i din browser.

## eBay, Tradera og Momox

De tre bruger officielle API'er, der kræver nøgler. I stedet for at lægge nøglerne i repoet henter den lokale app dem via projektets API-relay (`relay/server.js`). Kun søgeordet og filtrene sendes dertil. Alle andre platforme scrapes stadig direkte fra din egen IP.

Har du dine egne nøgler, kan du indsætte dem i `.env` (se `.env.example`). Så bruges de lokalt, og relayen springes over. Sæt `RELAY_URL=off` for at slå relayen helt fra.

### Hosting af relayen (kun for projektets ejer)

Deploy mappen på fx Render med `npm install` som build- og `npm run relay` som start-kommando, og sæt `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `TRADERA_APP_ID`, `TRADERA_APP_KEY` og `CONSTRUCTOR_KEY` som miljøvariabler. Indsæt derefter relayens URL i `DEFAULT_RELAY_URL` i `server.js`. Relayen begrænser hver IP til 60 forespørgsler i minuttet (`RELAY_RATE_LIMIT`).

## Test

Med serveren kørende:

```bash
npm test
```

Testen kører nogle søgninger og viser antal resultater pr. platform.

## Struktur

```
server.js                 Lokal Express-server (kun tilgængelig fra 127.0.0.1)
relay/server.js           API-relay til eBay/Tradera/Momox (hostes af projektets ejer)
public/                   Selve siden (ren HTML/CSS/JS, intet build-trin)
src/services/             Én scraper pr. platform
src/controllers/          Kategori-/størrelses-maps og fælles filtrering
scripts/smoke-test.js     Hurtig test af alle platforme
```

## God skik

Siden laver de samme opslag, som din browser ville lave, hvis du søgte på hver side for sig. Brug den til personlig søgning, og respektér de enkelte siders vilkår. Sider ændrer jævnligt deres HTML, så en platform kan pludselig give 0 resultater, indtil dens scraper i `src/services/` er opdateret.
