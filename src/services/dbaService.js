import { gotScraping } from 'got-scraping';
import { applyLocalFilters } from '../controllers/itemFilter.js';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { SIZE_MAP } from '../controllers/sizeMap.js';
import * as cheerio from 'cheerio';

const cleanDBATitle = (title) => {
    if (!title) return "";
    return title
        .replace(/ÅBN ANNONCE/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const extractSize = (text) => {
    if (!text) return "";
    
    const explicitMatch = text.match(/(?:str\.?|størrelse|size|sz)\s*:?\s*([0-9]{2}(?:[.,]5)?|[a-zA-Z]+(?:\/[a-zA-Z]+)?)/i);
    if (explicitMatch) return explicitMatch[1].replace(',', '.').toUpperCase();
    
    const matchLetters = text.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|4XL|5XL)\b/i);
    if (matchLetters) return matchLetters[1].toUpperCase();
    
    return "";
};

export const search = async (query, filters = {}) => {
    try {
        let effectiveQuery = (query || '').trim();
        const page = filters.page || 1;

        // --- 1. KØN OVERSÆTTER ---
        const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');
        const genderString = String(rawGender).toLowerCase();
        
        let genderKey = null; // Default er nu NULL (bred søgning)
        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
            genderKey = 'male';
        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
            genderKey = 'female';
        }
        
        // --- 2. KATEGORI OVERSÆTTER (STOLER PÅ FRONTENDEN) ---
        let categoryName = null;
        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId || '');
        if (typeof incomingCat === 'object' && incomingCat !== null) {
            incomingCat = incomingCat.label || incomingCat.value || String(incomingCat);
        }
        
        const cleanCat = String(incomingCat).trim().toLowerCase();

        if (cleanCat) {
            // 1. Forsøg et 1:1 match
            let matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase() === cleanCat);
            
            // 2. REVERSE-LOOKUP: Har frontenden sendt det rå DBA ID (fx 2.71.3950.183)?
            if (!matchedKey) {
                matchedKey = Object.keys(CATEGORY_MAP).find(key => {
                    const mId = CATEGORY_MAP[key]?.male?.dba?.toLowerCase() || '';
                    const fId = CATEGORY_MAP[key]?.female?.dba?.toLowerCase() || '';
                    return mId === cleanCat || fId === cleanCat;
                });
            }

            // 3. Sikkerhedsnet: Matcher på det første rigtige ord
            if (!matchedKey) {
                const firstWord = cleanCat.split(/[\s&]+/)[0]; 
                if (firstWord.length > 2) {
                    matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase().includes(firstWord));
                }
            }

            if (matchedKey) categoryName = matchedKey;
        }

        // --- 3. AUTO-DETEKTOR FOR SKO (KUN HVIS INGEN KATEGORI ER VALGT) ---
        const userSize = filters.size ? String(filters.size).split(',')[0].trim() : null;
        if (!categoryName && !cleanCat) {
            const eqLower = effectiveQuery.toLowerCase();
            const hasShoeKeywords = ['sneaker', 'sko', 'shoes', 'schuhe'].some(kw => eqLower.includes(kw));
            if (hasShoeKeywords) categoryName = 'Sko';
        }

       // --- 4. FIND DBA KATEGORI ID FRA CATEGORY_MAP ---
        let targetCategory = '0.71'; 
        const mapData = categoryName ? CATEGORY_MAP[categoryName] : CATEGORY_MAP["Alle"];
        
        if (mapData) {
            if (genderKey && mapData[genderKey]?.dba) {
                targetCategory = mapData[genderKey].dba;
            } else if (mapData.male?.dba) {
                 const splitId = mapData.male.dba.split('.');
                 
                 if (splitId.length >= 4) {
       
                     targetCategory = `1.${splitId[1]}.${splitId[2]}`; 
                 } else {
                     targetCategory = mapData.male.dba;
                 }
            }
        }

        // --- 5. STØRRELSE-PARAMETER FRA SIZEMAP ---
        const skipSize = ['Tasker', 'Accessories'].includes(categoryName);
        let sizeUrlParam = '';
        let sizeFilterApplied = false;

        if (userSize && !skipSize && genderKey) {
            if (categoryName === 'Sko') {
                sizeUrlParam = `&shoe_size=${userSize}`;
                sizeFilterApplied = true;
            } else {
                const sizeType = CATEGORY_MAP[categoryName]?.sizeType || 'clothing';
                const sizeData = SIZE_MAP[sizeType];

                if (sizeData?.parameters?.dba && sizeData?.values?.[userSize]?.dba) {
                    const pObj = sizeData.parameters.dba;
                    const vObj = sizeData.values[userSize].dba;

                    const paramName = typeof pObj === 'object' ? pObj[genderKey] : pObj;
                    const finalValue = typeof vObj === 'object' ? vObj[genderKey] : vObj;

                    if (paramName && finalValue) {
                        sizeUrlParam = `&${paramName}=${finalValue}`;
                        sizeFilterApplied = true;
                    }
                }
            }
        }

        // --- 6. TEKST BEREINIGEN (STØVSUGEREN & MÆRKE-RENSER) ---
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

        // --- 7. BYG DBA URL (DEN RIGTIGE!) ---
        let dbaUrl = `https://www.dba.dk/recommerce/forsale/search?page=${page}`;
        
        if (effectiveQuery) {
            dbaUrl += `&q=${encodeURIComponent(effectiveQuery)}`;
        }
        
        if (targetCategory.includes('=')) {
            dbaUrl += `&${targetCategory}`;
        } else if (targetCategory.includes('.')) {
            const dotCount = (targetCategory.match(/\./g) || []).length;
            if (dotCount >= 3) dbaUrl += `&product_category=${targetCategory}`;
            else if (dotCount === 2) dbaUrl += `&sub_category=${targetCategory}`;
            else dbaUrl += `&category=${targetCategory}`;
        } else {
            dbaUrl += `&category=${targetCategory}`;
        }

        if (sizeUrlParam) dbaUrl += sizeUrlParam;
        
        dbaUrl += filters.sortBy === 'newly_listed' ? `&sort=listingdate-desc` : `&sort=RELEVANCE`;
        if (filters.priceMin) dbaUrl += `&price_from=${filters.priceMin}`;
        if (filters.priceMax) dbaUrl += `&price_to=${filters.priceMax}`;

        console.log(`--- DEBUG DBA ---`);
        console.log(`Modtaget Kat: "${incomingCat}" -> Oversat til: ${categoryName}`);
        console.log(`Køn: ${genderKey}, Target: ${targetCategory}`);
        console.log(`URL: ${dbaUrl}`);

        const response = await gotScraping({
            url: dbaUrl,
            http2: false,
            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 112 }], devices: ['desktop'], locales: ['da-DK'] }
        });

        const $ = cheerio.load(response.body);
        let items = [];
        const seenIds = new Set();

        $('article.sf-search-ad').each((i, el) => {
            if (items.length >= (filters.limit || 40)) return false;
            try {
                const card = $(el);
                const linkTag = card.find('a.sf-search-ad-link, a[href*="/item/"]');
                const href = linkTag.attr('href');
                if (!href) return;
                
                const id = href.match(/\/item\/(\d+)/)?.[1];
                if (!id || seenIds.has(id)) return;
                seenIds.add(id);

                // --- DEN SMARTE TITEL-JÆGER ---
                let rawTitle = card.find('[data-testid="object-title"]').first().text().trim();
                
                // 1. Prøv overskrifter først (DBA's nye struktur)
                if (!rawTitle || rawTitle.toLowerCase().includes('åbn annonce')) {
                    rawTitle = card.find('h2, h3, h4').first().text().trim();
                }

                // 2. Prøv Linkets tekst eller aria-label (sletter "ÅBN ANNONCE")
                if (!rawTitle || rawTitle.toLowerCase().includes('åbn annonce')) {
                    rawTitle = linkTag.attr('aria-label') || linkTag.text().replace(/ÅBN ANNONCE/gi, '').trim();
                }

                // 3. Prøv specifikke tekst-klasser
                if (!rawTitle || rawTitle.toLowerCase().includes('åbn annonce')) {
                    rawTitle = card.find('.truncate, .text-s').first().text().replace(/ÅBN ANNONCE/gi, '').trim();
                }
                
                // 4. Som absolut sidste udvej: Prøv billedets ALT-tekst (KUN hvis det ikke er "Product image...")
                if (!rawTitle || rawTitle.toLowerCase().includes('åbn annonce')) {
                    const altText = card.find('img').attr('alt')?.trim() || "";
                    if (!altText.toLowerCase().includes('product image') && !altText.toLowerCase().includes('billede')) {
                        rawTitle = altText;
                    }
                }
                
                // 5. Sikkerhedsnet mod at "PRODUCT IMAGE" slipper igennem
                if (rawTitle.toLowerCase().includes('product image') || rawTitle.toLowerCase().includes('billede ')) {
                    rawTitle = filters.brand ? `${filters.brand} Vare` : "DBA Vare";
                }
                
                const title = cleanDBATitle(rawTitle) || "DBA Vare";

                // --- STØRRELSE & PRIS ---
                let scrapedSize = (userSize && sizeFilterApplied) ? userSize : '';
                
                if (!scrapedSize) {
                    const sizeText = card.find('.text-s, .break-words, .flex.flex-wrap').text().trim(); 
                    if (sizeText) {
                        scrapedSize = extractSize(sizeText);
                    }
                }

                const priceText = card.find('div.font-bold').text().replace(/[^\d]/g, '');
                
                items.push({
                    id: `dba-${id}`, 
                    title: title, 
                    price: parseInt(priceText) || 0, 
                    currency: 'DKK',
                    image: card.find('img').attr('src') || '',
                    url: href.startsWith('http') ? href : `https://www.dba.dk${href}`,
                    source: 'DBA', 
                    brand: filters.brand || '', 
                    size: scrapedSize,
                    country: 'DK'
                });
            } catch (err) {
                // Fejl på et enkelt kort ignoreres
            }
        });

        items = applyLocalFilters(items, filters);
        return { items, total: items.length };

    } catch (error) {
        console.error(`❌ DBA Fejl:`, error.message);
        return { items: [], total: 0 };
    }
};
