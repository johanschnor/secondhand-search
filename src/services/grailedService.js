import axios from 'axios';
import { applyLocalFilters } from '../controllers/itemFilter.js';

const APP_ID = 'MNRWEFSS2Q';
const API_KEY = 'c89dbaddf15fe70e1941a109bf7c2a3d';
const INDEX_NAME = 'Listing_by_listing_quality_production';

export const search = async (query, filters = {}) => {
    try {
        let searchParts = [];
        let facetFilters = [];
        
        // --- 1. RENS BRUGERENS TEKST (Ligesom Sellpy) ---
        let effectiveQuery = (query || '').trim();
        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child|sko|shoes|skor|taske|tasker|bag|bags|jakke|bukser|jeans|skjorte|strik)\b/gi, '').trim();

        if (effectiveQuery) searchParts.push(effectiveQuery);

        // --- 2. MÆRKE ---
        if (filters.brand) {
            const normBrand = String(filters.brand).toLowerCase();
            if (!effectiveQuery.toLowerCase().includes(normBrand)) {
                searchParts.push(String(filters.brand).trim());
            }
        }

        // --- 3. KØN (OVERSÆT TIL ENGELSK FRITEKST) ---
        const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');
        const genderString = String(rawGender).toLowerCase();
        
        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) searchParts.push('Mens');
        else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) searchParts.push('Womens');

        // --- 4. KATEGORI (OVERSÆT TIL ENGELSK FRITEKST) ---
        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || '');
        const cleanCat = String(incomingCat).trim();
        
        const grailedDictionary = {
            "Overtøj": "Outerwear", "Sweats": "Sweatshirt", "Jeans": "Jeans",
            "Bukser": "Pants", "T-shirts": "T-shirt", "Skjorter": "Shirt",
            "Strik": "Knitwear", "Sko": "Shoes", "Accessories": "Accessories", "Tasker": "Bag"
        };

        if (cleanCat && cleanCat !== 'Alle') {
            searchParts.push(grailedDictionary[cleanCat] || cleanCat);
        }

        // --- 5. STØRRELSE ---
        let userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;
        if (userSize) {
            searchParts.push(userSize);
        }

        // --- 6. BYG DEN PERFEKTE ENGELSKE SØGESTRENG ---
        let rawQueryString = searchParts.join(' ').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const finalQueryString = [...new Set(rawQueryString.split(/\s+/))].join(' ').trim();

        // --- 7. LOKATION OG STAND FACETS (Disse er sikre at bruge) ---
        if (filters.condition) {
            const cond = Array.isArray(filters.condition) ? filters.condition[0] : filters.condition;
            if (cond === 'new' || cond === 'new tags') facetFilters.push(['condition:new']); 
            else if (cond === 'used' || cond === 'good') facetFilters.push(['condition:used']); 
        }

        facetFilters.push(["location:Europe", "location:UK"]);

        // --- 8. BYG ALGOLIA REQUEST ---
        const params = new URLSearchParams();
        params.append('query', finalQueryString); 
        
        // Vi beder om 100 resultater, da vi søger bredt i fritekst, 
        // så din egen filter-fil har masser af varer at sortere i
        params.append('hitsPerPage', 100); 
        params.append('page', (filters.page || 1) - 1);
        
        if (facetFilters.length > 0) {
            params.append('facetFilters', JSON.stringify(facetFilters));
        }

        let numericFilters = [];
        if (filters.priceMin) numericFilters.push(`price_i>=${filters.priceMin}`);
        if (filters.priceMax) numericFilters.push(`price_i<=${filters.priceMax}`);
        if (numericFilters.length > 0) params.append('numericFilters', JSON.stringify(numericFilters));

        console.log(`--- DEBUG GRAILED ---`);
        console.log(`API Query sendt afsted: "${finalQueryString}"`);

        const url = `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX_NAME}/query`;
        const response = await axios.post(url, { params: params.toString() }, {
            headers: { 'X-Algolia-Application-Id': APP_ID, 'X-Algolia-API-Key': API_KEY, 'Content-Type': 'application/json' }
        });

        if (!response.data.hits) return { items: [], total: 0 };

        let items = response.data.hits.map(hit => {
            let image = hit.cover_photo?.url || (hit.photos?.[0]?.url) || '';
            if (image && !image.startsWith('http')) image = `https://cdn.fs.grailed.com/${image}`; 
            
            let apiSize = hit.size ? hit.size.toString().toUpperCase().replace(/US|EU|UK|IT|FR/g, '').trim() : '';

            return {
                id: `grailed-${hit.id}`, title: hit.title, price: hit.price_i || 0, currency: 'USD',          
                image: image || "https://via.placeholder.com/300?text=No+Image",
                url: `https://www.grailed.com/listings/${hit.id}`, source: 'Grailed', country: 'Europe',
                brand: hit.designers ? hit.designers.map(d => d.name).join(', ') : (filters.brand || ''), 
                size: apiSize
            };
        });

        const countBeforeFilter = items.length;

        // Vores lokale "Bouncer" fjerner støj (f.eks. kvindetøj, hvis der alligevel smuttede noget med)
        items = applyLocalFilters(items, filters);
        
        console.log(`🇺🇸 Grailed (EU/UK): Fandt ${countBeforeFilter} -> Godkendt: ${items.length}`);
        
        return { items, total: response.data.nbHits || items.length };

    } catch (error) {
        console.error(`❌ Grailed Fejl:`, error.message);
        return { items: [], total: 0 };
    }
};
