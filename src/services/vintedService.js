import { gotScraping } from 'got-scraping';

import * as cheerio from 'cheerio';

import { CATEGORY_MAP } from '../controllers/categoryMap.js';

import { SIZE_MAP } from '../controllers/sizeMap.js';

import { applyLocalFilters } from '../controllers/itemFilter.js';



// --- HJÆLPEFUNKTION TIL STØRRELSE FRA TEKST ---

const extractSize = (text) => {

    if (!text) return "";

    let t = text.trim();



    // 1. Fang Jeans (W30, W 32 osv.)

    const jeansMatch = t.match(/(?:^|\s)W\s*([2-4][0-9])(?=\s|$)/i);

    if (jeansMatch) return jeansMatch[1];



    // 2. Fang specifikke labels (str, size) efterfulgt af tal/bogstav.

    const explicitMatch = t.match(/(?:str|size|sz|eu|rozmiar|größe)[.:]?\s*([3-5][0-9](?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL)/i);

    if (explicitMatch) return explicitMatch[1].replace(',', '.').toUpperCase();



    // 3. Fang standalone bogstav-størrelser med RIGTIGE mellemrum

    // (Dette løser H&M, Varemærke, og "m." problemerne fuldstændigt!)

    const letterMatch = t.match(/(?:^|\s)(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS)(?=\s|$)/i);

    if (letterMatch) return letterMatch[1].toUpperCase();



    // 4. Fang tal-størrelser (sko/jeans)

    const numberMatch = t.match(/(?:^|\s)([3-5][0-9](?:[.,]5)?)(?=\s|$)/i);

    if (numberMatch) return numberMatch[1].replace(',', '.');



    return "";

};



export const search = async (query, filters = {}) => {

    try {

        let effectiveQuery = (query || '').trim();

        const params = new URLSearchParams();

        

        // --- 1. KØN OVERSÆTTER ---

        const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');

        const genderString = String(rawGender).toLowerCase();

        

        let genderKey = null; 

        

        // Vinteds overordnede katalog-ID'er: Mænd = 5, Kvinder = 1904, Børn = 1193

        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {

            genderKey = 'male';

            params.append('catalog[]', '5'); // Lås til Herreafdelingen

        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {

            genderKey = 'female';

            params.append('catalog[]', '1904'); // Lås til Dameafdelingen

        } else if (['child', 'børn', 'kids', 'börn'].some(g => genderString.includes(g))) {

            params.append('catalog[]', '1193'); // Lås til Børneafdelingen

        }

        

        // --- 2. KATEGORI OVERSÆTTER ---

        let categoryName = null;

        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId || '');

        if (typeof incomingCat === 'object' && incomingCat !== null) {

            incomingCat = incomingCat.label || incomingCat.value || String(incomingCat);

        }

        

        const cleanCat = String(incomingCat).trim().toLowerCase();



        if (cleanCat && cleanCat !== 'alle') {

            let matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase() === cleanCat);

            

            if (!matchedKey && /^\d+$/.test(cleanCat)) {

                matchedKey = Object.keys(CATEGORY_MAP).find(key => {

                    const mId = CATEGORY_MAP[key]?.male?.vinted?.toLowerCase() || '';

                    const fId = CATEGORY_MAP[key]?.female?.vinted?.toLowerCase() || '';

                    return mId === cleanCat || fId === cleanCat;

                });

            }



            if (!matchedKey) {

                const firstWord = cleanCat.split(/[\s&]+/)[0]; 

                if (firstWord.length > 2) {

                    matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase().includes(firstWord));

                }

            }



            if (matchedKey) categoryName = matchedKey;

        }



        // --- 3. AUTO-DETEKTOR FOR SKO ---

        const userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;

        if (!categoryName && !cleanCat) {

            const eqLower = effectiveQuery.toLowerCase();

            const hasShoeKeywords = ['sneaker', 'sko', 'shoes', 'schuhe'].some(kw => eqLower.includes(kw));

            if (hasShoeKeywords) categoryName = 'Sko';

        }



        // --- 4. FIND VINTED KATEGORI ID (SUBCAT) ---

        let targetCategory = '';

        const mapData = categoryName ? CATEGORY_MAP[categoryName] : CATEGORY_MAP["Alle"];

        

        if (mapData && categoryName !== 'Alle') {

            if (genderKey && mapData[genderKey]?.vinted) {

                targetCategory = mapData[genderKey].vinted;

            } else if (mapData.male?.vinted) {

                 targetCategory = mapData.male.vinted; // Fallback

            }

        }



        // --- 5. FIND VINTED STØRRELSE ID ---

        let sizeFilterApplied = false;



        const sizeGenderKey = genderKey || 'male'; 



        if (userSize && categoryName) { 

            let sizeType = CATEGORY_MAP?.[categoryName]?.sizeType || (categoryName === 'Sko' ? 'shoes' : 'clothing');

            

            if (SIZE_MAP?.[sizeType]) {

                const rawMappedValue = SIZE_MAP[sizeType].values?.[userSize]?.vinted;

                if (rawMappedValue) {

                    const mappedTargetSize = typeof rawMappedValue === 'object' ? rawMappedValue[sizeGenderKey] : rawMappedValue;

                    if (mappedTargetSize) {

                        params.append('size_ids[]', mappedTargetSize); 

                        sizeFilterApplied = true;

                    }

                }

            }

        }



        // --- 6. TEKST BEREINIGEN ---

        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child)\b/gi, '').trim();

        

        if (sizeFilterApplied && userSize) {

            const sizeRegex = new RegExp(`\\b${userSize.replace('.', ',')}\\b|\\b${userSize}\\b`, 'gi');

            effectiveQuery = effectiveQuery.replace(sizeRegex, '').trim();

        } else if (userSize && !effectiveQuery.toLowerCase().includes(userSize.toLowerCase())) {

            // Tilføj userSize til fritekst hvis Vinted ikke forstod størrelsen (f.eks tasker)

            effectiveQuery = `${effectiveQuery} ${userSize}`.trim();

        }



        if (filters.brand) {

            const normQuery = effectiveQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

            const normBrand = String(filters.brand).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

            

            if (!normQuery.includes(normBrand)) {

                effectiveQuery = effectiveQuery ? `${effectiveQuery} ${filters.brand}` : String(filters.brand);

            }

        }



        params.delete('catalog[]'); 



        if (effectiveQuery) {

            params.append('search_text', effectiveQuery);

        }

        params.append('page', filters.page || 1);

        params.append('currency', 'DKK');

        params.append('order', 'newest_first'); 

        

        if (filters.priceMin) params.append('price_from', filters.priceMin);

        if (filters.priceMax) params.append('price_to', filters.priceMax);

        

        if (targetCategory) {

            params.append('catalog[]', targetCategory);

        } else if (genderKey === 'male') {

            params.append('catalog[]', '5');

        } else if (genderKey === 'female') {

            params.append('catalog[]', '1904');

        } 



        const vintedUrl = `https://www.vinted.dk/catalog?${params.toString()}`;

        console.log(`--- DEBUG VINTED ---`);

        console.log(`Køn: ${genderKey || 'Alle'} | Kat: ${categoryName} | Original URL: ${vintedUrl}`);



       // --- SCRAPERAPI INTEGRATION ---

        const SCRAPER_API_KEY = process.env.SCRAPERAPI_KEY;

        let targetUrl = vintedUrl;

        

        if (SCRAPER_API_KEY) {

            console.log(`🔄 Sender Vinted-kald igennem ScraperAPI (premium) for at omgå Datadome...`);

            targetUrl = `http://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(vintedUrl)}&premium=true&country_code=eu`;

        }



        const response = await gotScraping({

            url: targetUrl,

            http2: false, 

            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 110 }], devices: ['desktop'], locales: ['da-DK'] },

            throwHttpErrors: false, 

            timeout: { request: 60000 },

            retry: { limit: 0 } // Vi lader ScraperAPI håndtere retries internt

        });



        // Tjek for fejl (fx 403 Bot Blokering) FØR vi kalder cheerio

        if (response.statusCode !== 200) {

            console.log(`🇫🇷 Vinted/Proxy afviste kaldet (Status: ${response.statusCode}).`);

            return { items: [], total: 0 };

        }



        // NU initialiserer vi cheerio sikkert

        const $ = cheerio.load(response.body);

        

        // Nu hvor $ er initialiseret, kan vi bruge det til debug info

        console.log(`🇫🇷 Vinted Status Code: ${response.statusCode}`);

        console.log(`🇫🇷 Vinted Sidetitel: ${$('title').text()}`);

        console.log(`🇫🇷 Fandt antal grid-items: ${$('[data-testid="grid-item"]').length}`);



        let items = []; 

        const seenIds = new Set();

        

        // Vi henter op til 60 elementer herfra, så vi har rigeligt til filteret.

        const maxItemsToFetch = filters.limit ? Math.max(filters.limit, 24) : 24;



        $('[data-testid="grid-item"]').each((i, el) => {

            if (items.length >= maxItemsToFetch) return false;

            try {

                const card = $(el);

                const linkTag = card.find('a').first();

                const href = linkTag.attr('href');

                if (!href) return;



                const idMatch = href.match(/\/items\/(\d+)-/);

                const id = idMatch ? idMatch[1] : Math.random().toString().substr(2, 8);

                if (seenIds.has(id)) return;

                seenIds.add(id);



                let title = card.find('img').attr('alt') || linkTag.attr('title') || "";

                title = title.replace(/billede af /i, '');



                const rawCardText = card.text();

                const priceMatch = rawCardText.match(/(\d+[.,]?\d*)\s?kr/);

                let price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.').replace(/\s/g, '')) : 0;



                let sizeDisplay = (userSize && sizeFilterApplied) ? userSize : (extractSize(rawCardText) || extractSize(title));



                items.push({

                    id: `vinted-${id}`, 

                    title: title || "Vinted Vare", 

                    price, 

                    currency: 'DKK', 

                    image: card.find('img').attr('src') || card.find('img').attr('data-src') || '',

                    url: href.startsWith('http') ? href : `https://www.vinted.dk${href}`,

                    source: 'Vinted', 

                    brand: filters.brand || '', 

                    country: 'DK', 

                    size: sizeDisplay

                });

            } catch (err) { }

        });



        const countBeforeFilter = items.length;



        items = applyLocalFilters(items, filters);

        

        console.log(`🇫🇷 Vinted: Fandt ${countBeforeFilter} varer -> Godkendt: ${items.length}`);

        

        return { items, total: items.length };



    } catch (error) {

        console.error(`❌ Vinted Fejl: ${error.message}`);

        return { items: [], total: 0 };

    }

}; 

