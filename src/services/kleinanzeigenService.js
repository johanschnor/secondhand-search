import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import { applyLocalFilters } from '../controllers/itemFilter.js';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { SIZE_MAP } from '../controllers/sizeMap.js';

const getHighResImage = (url) => {
    if (!url) return "";
    
    if (url.includes('$_')) {
        return url.replace(/\$_\d+/gi, "$_59"); 
    }
    
    return url;
};

const extractSize = (text) => {
    if (!text) return null;
    const explicitMatch = text.match(/(?:Gr\.?|Größe|Size)\s*[:.]?\s*([0-9]{2}(?:[.,]5)?|[a-zA-Z]{1,4})\b/i);
    if (explicitMatch) return explicitMatch[1].toUpperCase().replace(',', '.');
    const jeansMatch = text.match(/\b(?:W|Weite)?\s*([0-9]{2})\s*\/\s*(?:L|Länge)?\s*[0-9]{2}\b/i);
    if (jeansMatch) return jeansMatch[1];
    const wMatch = text.match(/\bW([0-9]{2})\b/i);
    if (wMatch) return wMatch[1];
    const standardMatch = text.match(/\b(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS|[0-9]{2}(?:\.[5])?)\b/i);
    if (standardMatch) return standardMatch[1].toUpperCase();
    return null;
};

export const search = async (query, filters = {}) => {
    try {
        let effectiveQuery = (query || '').trim();

        // --- 1. KØN OVERSÆTTER ---
        const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');
        const genderString = String(rawGender).toLowerCase();
        
        let genderKey = null; 
        
        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
            genderKey = 'male';
        } else if (['women', 'female', 'kvinder', 'dame', 'fraue'].some(g => genderString.includes(g))) {
            genderKey = 'female';
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
            
            // REVERSE-LOOKUP
            if (!matchedKey) {
                matchedKey = Object.keys(CATEGORY_MAP).find(key => {
                    const mId = CATEGORY_MAP[key]?.male?.kleinanzeigen?.toLowerCase() || '';
                    const fId = CATEGORY_MAP[key]?.female?.kleinanzeigen?.toLowerCase() || '';
                    
                    if (mId === cleanCat) { 
                        if(!genderKey) genderKey = 'male'; // Tving køn hvis vi finder ID'et
                        return true; 
                    }
                    if (fId === cleanCat) { 
                        if(!genderKey) genderKey = 'female'; // Tving køn hvis vi finder ID'et
                        return true; 
                    }
                    return false;
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
        const userSize = filters.size ? String(filters.size).split(',')[0].trim() : null;
        if (!categoryName && !cleanCat) {
            const eqLower = effectiveQuery.toLowerCase();
            const hasShoeKeywords = ['sneaker', 'sko', 'shoes', 'schuhe'].some(kw => eqLower.includes(kw));
            if (hasShoeKeywords) categoryName = 'Sko';
        }

        // --- 4. FIND KLEINANZEIGEN MASTER KATEGORI ID & PARAMETRE ---
        // Hvis INTET er valgt: c153 (Mode & Beauty - Blandet)
        // Hvis MÆND er valgt (men ingen underkategori): c160 (Herrenbekleidung)
        // Hvis KVINDER er valgt (men ingen underkategori): c154 (Damenbekleidung)
        let targetCategory = 'c153'; 
        if (genderKey === 'male') targetCategory = 'c160';
        if (genderKey === 'female') targetCategory = 'c154';

        let categoryExtraParams = '';
        
        // Tilsidesæt Master-ID'et, hvis vi har en specifik underkategori (f.eks. sko eller jakker)
        const mapData = categoryName ? CATEGORY_MAP[categoryName] : null;
        
        if (mapData) {
            // Hvis vi kender kønnet, slår vi op i det. Ellers bruger vi bare 'male' som grov fallback.
            const lookupGender = genderKey || 'male';
            
            if (mapData[lookupGender]?.kleinanzeigen) {
                const rawId = mapData[lookupGender].kleinanzeigen;
                const parts = rawId.split('+'); // Håndter fx c160+kleidung_herren.art_s:jacken_maentel
                targetCategory = parts[0];
                if (parts[1]) categoryExtraParams = `+${parts[1]}`;
            }
        }

        // --- 5. STØRRELSE-PARAMETER FRA SIZEMAP ---
        const skipSize = ['Tasker', 'Accessories'].includes(categoryName);
        let sizeUrlPart = '';
        let sizeFilterApplied = false;

        // VIGTIGT: Kleinanzeigen kræver et køn for at kunne klistre en størrelse på i URL'en (fordi paramName ofte indeholder kønnet)
        // Vi bruger 'male' som en skjult fallback KUN til URL-byggeri, så funktionen ikke crasher.
        const sizeGenderKey = genderKey || 'male'; 

        if (userSize && !skipSize) {
            const sizeType = CATEGORY_MAP[categoryName]?.sizeType || (categoryName === 'Sko' ? 'shoes' : 'clothing');
            const sizeData = SIZE_MAP[sizeType];

            if (sizeData?.parameters?.kleinanzeigen && sizeData?.values?.[userSize]?.kleinanzeigen) {
                const pObj = sizeData.parameters.kleinanzeigen;
                const vObj = sizeData.values[userSize].kleinanzeigen;

                const paramName = typeof pObj === 'object' ? pObj[sizeGenderKey] : pObj;
                const finalValue = typeof vObj === 'object' ? vObj[sizeGenderKey] : vObj;

                if (paramName && finalValue) {
                    sizeUrlPart = `+${paramName}:${finalValue}`;
                    sizeFilterApplied = true;
                }
            }
        }

        // --- 6. TEKST BEREINIGEN ---
        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child)\b/gi, '').trim();
        
        if (sizeFilterApplied && userSize) {
            const sizeRegex = new RegExp(`\\b${userSize.replace('.', ',')}\\b|\\b${userSize}\\b`, 'gi');
            effectiveQuery = effectiveQuery.replace(sizeRegex, '').trim();
        } else if (userSize && !effectiveQuery.toLowerCase().includes(userSize.toLowerCase())) {
            effectiveQuery = `${effectiveQuery} ${userSize}`.trim(); 
        }

        if (filters.brand) {
            const normQuery = effectiveQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const normBrand = String(filters.brand).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            
            if (!normQuery.includes(normBrand)) {
                effectiveQuery = effectiveQuery ? `${effectiveQuery} ${filters.brand}` : String(filters.brand);
            }
        }

        const formattedQuery = effectiveQuery
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, '-')
            .toLowerCase();

        // --- 7. FINALE URL BAUEN ---
        let categorySlug = '';
        if (targetCategory === 'c158') categorySlug = 'schuhe-herren/';
        else if (targetCategory === 'c159') categorySlug = 'schuhe-damen/';
        else if (targetCategory === 'c160') categorySlug = 'herrenbekleidung/';
        else if (targetCategory === 'c154') categorySlug = 'damenbekleidung/';
        else if (targetCategory === 'c153') categorySlug = 'mode-beauty/';

        let pathPrefix = 's-';
        if (categorySlug) pathPrefix += categorySlug;
        if (formattedQuery) pathPrefix += formattedQuery;
        else if (categorySlug) pathPrefix = pathPrefix.slice(0, -1);

        let url = `https://www.kleinanzeigen.de/${pathPrefix}/k0${targetCategory}${categoryExtraParams}${sizeUrlPart}`;
        if (filters.page && filters.page > 1) {
            url = `https://www.kleinanzeigen.de/s-seite:${filters.page}/${pathPrefix.replace('s-', '')}/k0${targetCategory}${categoryExtraParams}${sizeUrlPart}`;
        }

        console.log(`--- DEBUG KLEINANZEIGEN ---`);
        console.log(`Køn: ${genderKey || 'Alle'} | Target: ${targetCategory}`);
        console.log(`URL: ${url}`);

        // --- SCRAPING ---
        const response = await gotScraping({
            url: url,
            http2: true, 
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                locales: ['de-DE', 'en-US'],
            },
            headers: { 'Referer': 'https://www.google.com/' }
        });

        if (response.statusCode !== 200) return { items: [], total: 0 };

        const $ = cheerio.load(response.body);
        let items = [];
        
        // Vi henter op til 60 items fra DOM'en for at fodre filteret
       const fetchLimit = filters.limit ? Math.max(filters.limit, 60) : 60;

        // Kleinanzeigen skiftede markup i 2026: annoncer er nu <article data-adid data-href>.
        // Det gamle layout (li.ad-listitem) beholdes som fallback.
        $('article[data-adid], li.ad-listitem').each((i, el) => {
            if (items.length >= fetchLimit) return false;
            try {
                const element = $(el);

                // Ignorer sponsorerede "Top-Ads", hvis du kun vil have rigtige brugerannoncer
                if (element.hasClass('is-top-ad')) return;

                const linkEl = element.find('a.ellipsis').length ? element.find('a.ellipsis') : element.find('h2, h3').first();
                const relativeLink = linkEl.attr('href') || element.attr('data-href') || element.find('a[href^="/s-anzeige/"]').attr('href');
                if (!relativeLink) return;

                const fullLink = `https://www.kleinanzeigen.de${relativeLink}`;
                const title = linkEl.text().trim();
                const id = element.attr('data-adid') || relativeLink.split('/').pop().split('-')[0];

                let priceText = element.find('.aditem-main--middle--price-shipping--price').text().trim() || element.find('.aditem-main--middle--price').text().trim()
                    || element.find('p.text-title3').not('.line-through').first().text().trim();
                let price = 0;
                if (priceText) { 
                    price = parseFloat(priceText.replace(/[^\d,]/g, '').replace(',', '.'));
                }

                // --- STØRRELSES-BAROMETERET ---
                // 1. Førsteprioritet: Brugerens søgning (fx "Supreme Hoodie XL" -> "XL")
                // Vi bruger bare `userSize` uanset om det kom fra URL'en eller fritekst
                let size = userSize ? userSize : '';

                // 2. Andenprioritet: Kleinanzeigens egne små grå badges i bunden af kortet
                if (!size) {
                    // Vi kigger efter både .simple-tag og .simpletag for at være sikre
                    element.find('.simple-tag, .simpletag, span.w-fit').each((_, tag) => {
                        const tagText = $(tag).text().trim();
                        // Vi filtrerer alt støj fra, der handler om forsendelse
                        if (!size && !tagText.toLowerCase().includes('versand')) {
                            size = extractSize(tagText);
                        }
                    });
                }
                
                // 3. Tredjeprioritet (Sikkerhedsnet): Gæt ud fra annoncens overskrift
                if (!size) {
                    size = extractSize(title) || '';
                }

                let image = element.find('.imagebox').attr('data-imgsrc') || element.find('img').attr('data-src') || element.find('img').attr('src');
                // Nyt layout: billedet ligger med fuld URL i et ld+json ImageObject
                if (!image || !element.find('.imagebox').length) {
                    try {
                        const ld = JSON.parse(element.find('script[type="application/ld+json"]').first().html() || '{}');
                        if (ld.contentUrl) image = ld.contentUrl;
                    } catch (e) {}
                }
                
                // HUSK: Du kalder getHighResImage her. 
                // Sørg for at den funktion faktisk findes i toppen af din fil!
                if (typeof getHighResImage === 'function') {
                    image = getHighResImage(image);
                }
                
                items.push({
                    id: `klein-${id}`, 
                    title: title, 
                    price: isNaN(price) ? 0 : price, 
                    currency: 'EUR',
                    image: image || "https://via.placeholder.com/300?text=No+Image",
                    url: fullLink, 
                    source: 'Kleinanzeigen', 
                    country: 'DE',
                    brand: filters.brand || '', 
                    size: size
                });
            } catch (e) {}
        });

        const countBeforeFilter = items.length;

        items = applyLocalFilters(items, filters);
        
        console.log(`🇩🇪 Kleinanzeigen: Fandt ${countBeforeFilter} varer -> Godkendt: ${items.length}`);
        
        return { items, total: items.length };

    } catch (error) {
        console.error("Kleinanzeigen Error:", error);
        return { items: [], total: 0 };
    }
};
