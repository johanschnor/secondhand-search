import { gotScraping } from 'got-scraping';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { SIZE_MAP } from '../controllers/sizeMap.js';
import { applyLocalFilters } from '../controllers/itemFilter.js';

const AWIN_MID = process.env.AWIN_MID;
const AWIN_AFFID = process.env.AWIN_AFFID;
const CONSTRUCTOR_KEY = process.env.CONSTRUCTOR_KEY;

const wrapAffiliateUrl = (directUrl) => {
    return `https://www.awin1.com/cread.php?awinmid=${AWIN_MID}&awinaffid=${AWIN_AFFID}&ued=${encodeURIComponent(directUrl)}`;
};

export const search = async (query, filters = {}) => {
    try {
        let effectiveQuery = query ? query.trim() : '';

        // --- 1. KØN OVERSÆTTER ---
        let rawGender = Array.isArray(filters.kon) ? filters.kon[0] : filters.kon;
        if (rawGender === undefined || rawGender === null) {
            rawGender = '';
        }
        
        const genderString = rawGender.toString().toLowerCase();
        
        let genderKey = null; 
        let genderPrefix = '';

        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
            genderKey = 'male';
            genderPrefix = 'Herren';
        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
            genderKey = 'female';
            genderPrefix = 'Damen';
        }

        const translationGenderKey = genderKey || 'male';

        // --- 2. KATEGORI OVERSÆTTER ---
        let categoryName = null;
        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId || '');
        if (typeof incomingCat === 'object' && incomingCat !== null) {
            incomingCat = incomingCat.label || incomingCat.value || String(incomingCat);
        }
        
        const cleanCat = String(incomingCat).trim().toLowerCase();

        if (cleanCat && cleanCat !== 'alle') {
            let matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase() === cleanCat);
            
            if (!matchedKey) {
                matchedKey = Object.keys(CATEGORY_MAP).find(key => {
                    const mId = CATEGORY_MAP[key]?.male?.momox?.toLowerCase() || '';
                    const fId = CATEGORY_MAP[key]?.female?.momox?.toLowerCase() || '';
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

        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child)\b/gi, '').trim();
        
        // --- 3. AUTO-DETEKTOR FOR SKO ---
        const userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;
        if (!categoryName && !cleanCat) {
            const eqLower = effectiveQuery.toLowerCase();
            const hasShoeKeywords = ['sneaker', 'sko', 'shoes', 'schuhe'].some(kw => eqLower.includes(kw));
            if (hasShoeKeywords) categoryName = 'Sko';
        }

        // --- 4. HENT TYSK KATEGORI ORD ---
        let mappedCategory = '';
        const mapData = categoryName ? CATEGORY_MAP[categoryName] : null;
        
        if (mapData && mapData[translationGenderKey]?.momox) {
            mappedCategory = mapData[translationGenderKey].momox;
        } else if (categoryName) {
            const germanDictionary = {
                "Overtøj": "Jacken", "Sweats": "Pullover", "Sweatshirts & Hoodies": "Pullover", "Jeans": "Jeans",
                "Bukser": "Hosen", "T-shirts": "T-Shirts", "Skjorter": "Hemden",
                "Strik": "Strick", "Sko": "Schuhe", "Accessories": "Accessoires", "Tasker": "Taschen"
            };
            mappedCategory = germanDictionary[categoryName] || categoryName;
        }

        if (mappedCategory && !effectiveQuery.toLowerCase().includes(mappedCategory.toLowerCase())) {
            effectiveQuery = effectiveQuery ? `${effectiveQuery} ${mappedCategory}` : mappedCategory;
        }

        // --- 5. TILFØJ TYSK KØN ELLER FALLBACK ---
        if (genderPrefix) {
            if (!effectiveQuery) {
                effectiveQuery = genderPrefix === 'Herren' ? 'Herrenbekleidung' : 'Damenbekleidung';
            } else if (!effectiveQuery.toLowerCase().includes(genderPrefix.toLowerCase()) && !effectiveQuery.toLowerCase().includes('herren-') && !effectiveQuery.toLowerCase().includes('damen-')) {
                effectiveQuery = `${genderPrefix} ${effectiveQuery}`;
            }
        } 
        else if (!effectiveQuery) {
            effectiveQuery = 'Bekleidung'; 
        }

        // --- 6. BRAND ---
        if (filters.brand) {
            const normQuery = effectiveQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            const normBrand = String(filters.brand).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            
            if (!normQuery.includes(normBrand)) {
                effectiveQuery = `${effectiveQuery} ${filters.brand}`.trim();
            }
        }

        // --- 7. URL-STØRRELSE (VIA SIZEMAP!) ---
        const skipSize = ['Tasker', 'Accessories'].includes(categoryName) || /taske|tasker|bag|bags|backpack|accessori/i.test(effectiveQuery);
        let sizeFilterUrl = "";
        
        if (userSize && !skipSize) {
            let sizeType = CATEGORY_MAP[categoryName]?.sizeType || (categoryName === 'Sko' ? 'shoes' : 'clothing');

            if (SIZE_MAP[sizeType]) {
                const paramObj = SIZE_MAP[sizeType].parameters?.momox; 
                const valueObj = SIZE_MAP[sizeType].values?.[userSize]?.momox;

                if (paramObj && valueObj) {
                    let finalParamName = typeof paramObj === 'object' ? paramObj[translationGenderKey] : paramObj;
                    const finalMappedValue = typeof valueObj === 'object' ? valueObj[translationGenderKey] : valueObj;

                    if (finalParamName && finalParamName.startsWith("filter[")) {
                        finalParamName = finalParamName.replace("filter[", "filters[");
                    }
                    if (finalParamName && !finalParamName.endsWith("[]")) {
                        finalParamName += "[]";
                    }

                    if (finalParamName && finalMappedValue) {
                        sizeFilterUrl = `&${encodeURIComponent(finalParamName)}=${encodeURIComponent(finalMappedValue)}`;
                    }
                }
            }
        }

        const encodedQuery = encodeURIComponent(effectiveQuery);
        const limit = filters.limit ? Math.max(filters.limit, 50) : 50; 
        
        const page = parseInt(filters.page) || 1;
        const offset = (page - 1) * limit;

const apiUrl = `https://ac.cnstrc.com/search/${encodedQuery}?key=${CONSTRUCTOR_KEY}&page=${page}&num_results_per_page=${limit}&i=d2a9f4c1-5b7e-4d8a-9c3f-1e6b7a2f4c5d&s=1&fmt_options%5Bgroups_start%5D=top&fmt_options%5Bgroups_max_depth%5D=6${sizeFilterUrl}`;        
        console.log(`--- DEBUG MOMOX ---`);
        console.log(`Køn: ${genderKey || 'Alle'} | Query: "${effectiveQuery}" | Side: ${page}`);

        const response = await gotScraping({
            url: apiUrl,
            responseType: 'json', 
            throwHttpErrors: false,
            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'], locales: ['en-US', 'da-DK'] }
        });

        if (response.statusCode !== 200) {
            console.error(`❌ Momox Afvist! Statuskode: ${response.statusCode}`);
            console.error(`❌ Mangler du din CONSTRUCTOR_KEY i .env? Værdi lige nu: ${CONSTRUCTOR_KEY}`);
            console.error(`❌ Prøvede at kalde URL: ${apiUrl}`);
            return { items: [], total: 0 };
        }

        const data = response.body;
        const rawItems = data?.response?.results || [];

        let items = rawItems.map(item => {
            const p = item.data;
            if (!p) return null;
            
            let condition = "Brugt";
            if (p.condition === 'very good') condition = "Meget god";
            if (p.condition === 'like new') condition = "Som ny";

            let image = p.image_url ? p.image_url.split('?')[0] + "?width=600" : '';
            let itemUrl = p.url || '';
            if (itemUrl && !itemUrl.startsWith('http')) itemUrl = `https://www.momoxfashion.com${itemUrl}`;

            return {
                id: `momox-${p.id || item.value}`,
                title: item.value || p.brand_name || 'Secondhand Item',
                brand: p.brand_name || 'Momox Fashion',
                price: parseFloat(p.price_momoxfashion_de) || 0,
                currency: 'EUR',
                image: image,
                url: wrapAffiliateUrl(itemUrl),
                source: 'Momox',
                size: p.original_size || '',
                condition: condition,
                country: 'DE'
            };
        }).filter(i => i !== null && i.price > 0);

        const countBeforeFilter = items.length;

        // Bounceren fra itemFilter tager over, den klarede "Momox fritekst-dræberen" fjerner vi.
        items = applyLocalFilters(items, filters);

        console.log(`🇩🇪 Momox: Fandt ${countBeforeFilter} varer -> Godkendt: ${items.length}`);

        return { items, total: data?.response?.total_num_results || items.length };

    } catch (error) {
        console.error(`❌ Momox Fejl: ${error.message}`);
        return { items: [], total: 0 };
    }
};
