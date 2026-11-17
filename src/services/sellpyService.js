import { gotScraping } from 'got-scraping';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { applyLocalFilters } from '../controllers/itemFilter.js';

const APP_ID = 'F1JX0VYE3G';
const API_KEY = '853170d0bcb8edda1d8ce97c5ded2b24';
const INDEX_NAME = 'prod_marketItem_en_relevance';

const toSlug = (text) => text ? text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '') : 'item';

export const search = async (query, filters = {}) => {
    try {
        let searchParts = [];
        let facetFilters = [];
        let effectiveQuery = (query || '').trim();
        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child|sko|shoes|skor|taske|tasker|bag|bags|jakke|bukser|jeans|skjorte|strik)\b/gi, '').trim();

        if (effectiveQuery) searchParts.push(effectiveQuery);
        
        if (filters.brand) {
            const normBrand = String(filters.brand).toLowerCase();
            if (!effectiveQuery.toLowerCase().includes(normBrand)) {
                searchParts.push(String(filters.brand).trim());
            }
        }

        // --- 2. KØN (OVERSAT TIL ENGELSK FOR ALGOLIA) ---
        const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');
        const genderString = String(rawGender).toLowerCase();
        
        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
            searchParts.push('Men');
        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
            searchParts.push('Women');
        } else if (['child', 'børn', 'kids', 'börn'].some(g => genderString.includes(g))) {
            searchParts.push('Kids');
        }

        // --- 3. KATEGORI (OVERSAT TIL ENGELSK FOR ALGOLIA) ---
        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId || '');
        if (typeof incomingCat === 'object' && incomingCat !== null) {
            incomingCat = incomingCat.label || incomingCat.value || String(incomingCat);
        }
        const cleanCat = String(incomingCat).trim();

        // Vi oversætter dine kategorier til de engelske ord, Sellpy bruger i deres data
        const sellpyDictionary = {
            "Overtøj": "Outerwear",
            "Sweats": "Sweatshirt",
            "Jeans": "Jeans",
            "Bukser": "Pants",
            "T-shirts": "T-shirt",
            // MAGIEN: Vi beder om Shirt, men forbyder T-shirts, Polo og Sweats!
            "Skjorter": "Shirt -T-shirt -Sweatshirt -Polo", 
            "Strik": "Knitwear",
            "Sko": "Shoes",
            "Accessories": "Accessories",
            "Tasker": "Bag"
        };

        if (cleanCat && cleanCat !== 'Alle') {
            const englishCategory = sellpyDictionary[cleanCat] || cleanCat;
            searchParts.push(englishCategory);
        }

        // --- 4. STØRRELSE ---
        let userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;
        if (userSize) {
            searchParts.push(userSize);
        }

       // --- 5. BYG DEN ENDELIGE ALGOLIA STRENG ---
        let rawQueryString = searchParts.join(' ').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const finalQueryString = [...new Set(rawQueryString.split(/\s+/))].join(' ').trim();

        // Sikker sidetals-udregning: Algolia starter ALTID på side 0
        const page = parseInt(filters.page) || 1;
        const algoliaPage = Math.max(0, page - 1); 
        const hitsLimit = filters.limit && filters.limit <= 10 ? 30 : 60;

        const params = new URLSearchParams();
        params.append('query', finalQueryString); 
        
        // Spredehagl 1: Sidetal inde i parameter-strengen
        params.append('hitsPerPage', hitsLimit);
        params.append('page', algoliaPage);

        // --- 6. STAND (FACET) ---
        if (filters.condition) {
            const c = Array.isArray(filters.condition) ? filters.condition[0] : filters.condition;
            if (c === 'new' || c === 'new tags') facetFilters.push(["condition:New"]);
            else if (c === 'good') facetFilters.push(["condition:Very Good", "condition:Good"]);
        }

        if (facetFilters.length > 0) {
            params.append('facetFilters', JSON.stringify(facetFilters));
        }

        let numericFilters = [];
        if (filters.priceMin) numericFilters.push(`price_DK.amount >= ${filters.priceMin * 100}`);
        if (filters.priceMax) numericFilters.push(`price_DK.amount <= ${filters.priceMax * 100}`);
        if (numericFilters.length > 0) params.append('numericFilters', numericFilters.join(','));

        console.log(`--- DEBUG SELLPY ---`);
        console.log(`Søger: "${finalQueryString}" | Side: ${page} (Algolia Page: ${algoliaPage})`);

        const url = `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX_NAME}/query`;
        
        // Spredehagl 2: Sidetal placeret direkte i roden af JSON-payloadet
        const payload = {
            params: params.toString(),
            page: algoliaPage,         // <-- Tvinger Algolia til at skifte side!
            hitsPerPage: hitsLimit     // <-- Tvinger Algolia til at skifte side!
        };

        const response = await gotScraping({
            url, method: 'POST',
            headers: { 'x-algolia-api-key': API_KEY, 'x-algolia-application-id': APP_ID, 'content-type': 'application/json' },
            body: JSON.stringify(payload), 
            responseType: 'json'
        });

        const hits = response.body.hits;
        if (!hits) return { items: [], total: 0 };

        let items = hits.map(hit => {
            try {
                let price = hit.price_DK?.amount ? hit.price_DK.amount / 100 : (hit.price ? hit.price / 100 : 0);
                if (!price) return null;

                let imgId = hit.image?.url || hit.image || (hit.images?.[0]?.url || hit.images?.[0]);
                let image = imgId && !imgId.startsWith('http') ? `https://sellpy-image.sellpy.net/${imgId}` : imgId;

                let brandName = hit.brand || hit.metadata?.brand || "";
                let typeName = hit.type || hit.metadata?.type || "";
                let title = hit.header || hit.title || `${brandName} ${typeName}`.trim() || 'Sellpy Vare';

                let size = hit.size || hit.metadata?.size || '';
                if (size) {
                    size = size.toString().toUpperCase().replace(/^(MEN|WOMEN|WOMAN|WMN|UNISEX|KIDS|INT|EU|UK|US|IT|FR|PANTS|INCH|DK|SHOES)-/i, '').replace(/-/g, '').replace(/"/g, '').trim();
                }

                return {
                    id: `sellpy-${hit.objectID}`, title, price, currency: 'DKK',
                    image: image || '', url: `https://www.sellpy.dk/item/${hit.objectID}/${toSlug(title)}`,
                    source: 'Sellpy', size: size, country: 'DK', brand: brandName
                };
            } catch (e) { return null; }
        }).filter(Boolean);

        const countBeforeFilter = items.length;

        // Vores bouncer fjerner bare evt. støj, som Algolia missede
        items = applyLocalFilters(items, filters);
        
        console.log(`🇸🇪 Sellpy: Fandt ${countBeforeFilter} -> Godkendt: ${items.length}`);
        
        return { items, total: response.body.nbHits || items.length };

    } catch (error) { 
        console.error(`❌ Sellpy Fejl: ${error.message}`);
        return { items: [], total: 0 }; 
    }
};
