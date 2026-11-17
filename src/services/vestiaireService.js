import { gotScraping } from 'got-scraping';
import { applyLocalFilters } from '../controllers/itemFilter.js';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';

const VESTIAIRE_API_URL = 'https://search.vestiairecollective.com/v1/product/search';

// --- HJÆLPERE ---
const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const extractText = (val) => {
    if (!val) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    if (typeof val === 'object') return val.name || val.label || val.value || val.text || '';
    return '';
};

const extractPrice = (priceData) => {
    if (priceData === null || priceData === undefined) return 0;
    if (typeof priceData === 'number') return priceData;
    if (typeof priceData === 'string') {
        const parsed = parseFloat(priceData.replace(/[^\d.]/g, ''));
        return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof priceData === 'object') {
        if (priceData.fractional !== undefined) return priceData.fractional / 100;
        if (priceData.cents !== undefined) return priceData.cents / 100;
        if (priceData.amount !== undefined) return parseFloat(priceData.amount);
        if (priceData.value !== undefined) return parseFloat(priceData.value);
        if (priceData.discounted) return extractPrice(priceData.discounted);
        if (priceData.current) return extractPrice(priceData.current);
        if (priceData.base) return extractPrice(priceData.base);
        for (const key in priceData) {
            if (typeof priceData[key] === 'number') {
                return priceData[key] > 5000 ? priceData[key] / 100 : priceData[key];
            }
        }
    }
    return 0;
};

export const search = async (query, filters = {}) => {
    try {
        let searchParts = [];
        const page = filters.page || 1;
        const limit = filters.limit ? Math.max(filters.limit, 60) : 60; 

        // --- 1. SØGEORD FRA FRITEKSTFELTET ---
        if (query && query.trim()) {
            searchParts.push(query.trim());
        }

        // --- 2. MÆRKE (Sættes FORREST for at prioritere det hos Vestiaire) ---
        let brandFilter = extractText(filters.brand);
        if (brandFilter && !searchParts.some(p => p.toLowerCase().includes(brandFilter.toLowerCase()))) {
            searchParts.unshift(brandFilter.trim());
        }

        // --- 3. KATEGORI ---
        let categoryName = null;
        let incomingCat = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId || '');
        if (typeof incomingCat === 'object' && incomingCat !== null) {
            incomingCat = incomingCat.label || incomingCat.value || String(incomingCat);
        }
        const cleanCat = String(incomingCat).trim().toLowerCase();

        if (cleanCat && cleanCat !== 'alle') {
            let matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase() === cleanCat);
            if (!matchedKey) {
                const firstWord = cleanCat.split(/[\s&]+/)[0]; 
                if (firstWord.length > 2) {
                    matchedKey = Object.keys(CATEGORY_MAP).find(key => key.toLowerCase().includes(firstWord));
                }
            }
            if (matchedKey) categoryName = matchedKey;
        }

        if (categoryName) {
            const englishDictionary = {
                "Overtøj": "Jacket", "Sweats": "Sweatshirt", "Jeans": "Jeans",
                "Bukser": "Trousers", "T-shirts": "T-shirt", "Skjorter": "Shirt",
                "Strik": "Sweater", "Sko": "Sneakers", "Accessories": "Accessories", "Tasker": "Bag"
            };
            const engCat = englishDictionary[categoryName] || categoryName;
            if (!searchParts.some(p => p.toLowerCase().includes(engCat.toLowerCase()))) {
                searchParts.push(engCat);
            }
        }

        // --- 4. KØN ---
        let rawGender = Array.isArray(filters.kon) ? filters.kon[0] : filters.kon;
        if (rawGender === undefined || rawGender === null) rawGender = '';
        const genderString = rawGender.toString().toLowerCase();
        let genderKey = null; 
        
        if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
            searchParts.push('Men');
            genderKey = 'male';
        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
            searchParts.push('Women');
            genderKey = 'female';
        }

        // --- 5. STØRRELSE ---
        let userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;
        if (userSize && !searchParts.some(p => p.toUpperCase().includes(userSize))) {
            searchParts.push(userSize);
        }

        if (searchParts.length === 0) searchParts.push('Clothing'); 

        let rawQueryString = searchParts.join(' ');
        const finalQueryString = [...new Set(rawQueryString.split(/\s+/))].join(' ').trim();

        // --- 6. SORTERING ---
        let sortBy = "relevance";
        if (filters.sortBy === 'newly_listed') sortBy = "relevance"; 
        if (filters.sortBy === 'price_asc') sortBy = "price_asc";
        if (filters.sortBy === 'price_desc') sortBy = "price_desc";

        const safePage = parseInt(filters.page) || 1;
        const safeLimit = 60; // Vestiaire foretrækker bidder af 60
        const offset = (safePage - 1) * safeLimit;

        const payload = {
            pagination: { 
                offset: offset, 
                limit: safeLimit 
                // REN JSON: Vi sender KUN offset og limit, så de ikke afviser os!
            },
            fields: [
                "name", "description", "brand", "model", "country", "price", 
                "discount", "link", "sold", "likes", "editorPicks", "shouldBeGone", 
                "seller", "directShipping", "local", "pictures", "colors", "size", 
                "stock", "universeId", "createdAt"
            ],
            facets: {
                fields: [
                    "brand", "universe", "country", "stock", "color", "categoryLvl0", 
                    "priceRange", "price", "condition", "region", "editorPicks", 
                    "watchMechanism", "discount", "sold", "directShippingEligible", 
                    "directShippingCountries", "localCountries", "sellerBadge", 
                    "isOfficialStore", "materialLvl0", "materialLvl1", "size0", "size1"
                ],
                stats: ["price"]
            },
            q: finalQueryString,
            sortBy: sortBy,
            filters: {},
            locale: { country: "DK", currency: "DKK", language: "en", sizeType: "US" },
            mySizes: null,
            options: {
                innerFeedContext: "recentSearches", 
                disableHierarchicalParentFiltering: true, 
                enableGuidedSearch: true
            }
        };

        console.log(`--- DEBUG VESTIAIRE ---`);
        console.log(`Søger: "${finalQueryString}" | Køn: ${genderKey || 'Alle'} | Side: ${safePage} (Offset: ${offset})`);
        
        // --- 8. SCRAPING ---
        const response = await gotScraping({
            url: VESTIAIRE_API_URL,
            method: 'POST',
            responseType: 'json',
            json: payload, 
            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'], locales: ['da-DK', 'en-US'] },
            headers: {
                'Origin': 'https://www.vestiairecollective.com',
                'Referer': 'https://www.vestiairecollective.com/',
                'Accept': 'application/json',
                // Vi går tilbage til dine dynamiske ID'er, så vi ikke bliver blacklistet
                'x-deviceid': generateUUID(),
                'x-search-session-id': generateUUID(),
                'x-search-query-id': generateUUID(),
                'x-usecase': 'recentSearches'
            }
        });

        if (response.statusCode !== 200 || !response.body || !response.body.items) {
            return { items: [], total: 0 };
        }

        const rawItems = response.body.items || [];

        let items = rawItems.map(item => {
            try {
                let itemPrice = extractPrice(item.price) || extractPrice(item.discount);

                let image = item.picture || (item.pictures && item.pictures.length > 0 ? item.pictures[0] : '');
                if (image && typeof image === 'object') image = image.url || image.src || ''; 
                if (image && !image.startsWith('http')) {
                    image = `https://images.vestiairecollective.com/cdn-cgi/image/w=500,q=80,f=auto/${image}`;
                }

                let itemUrl = extractText(item.link);
                if (itemUrl && !itemUrl.startsWith('http')) {
                    itemUrl = `https://www.vestiairecollective.com${itemUrl.startsWith('/') ? '' : '/'}${itemUrl}`;
                }

                const safeBrand = extractText(item.brand) || brandFilter || '';
                
                // Klipper "INTERNATIONAL" og "INT" væk fra størrelsen
                let safeSize = extractText(item.size);
                safeSize = safeSize.replace(/\s*INTERNATIONAL/gi, '').replace(/\s*INT/gi, '').trim();

                const safeModel = extractText(item.model);
                let safeTitle = extractText(item.name) || safeModel || 'Vestiaire Vare';
                
                // Tving mærket ind i titlen, hvis det ikke allerede står der
                if (safeBrand && !safeTitle.toLowerCase().includes(safeBrand.toLowerCase())) {
                    safeTitle = `${safeBrand} ${safeTitle}`.trim();
                }

                const safeCondition = extractText(item.condition) || 'Brugt';
                const safeCountry = extractText(item.country) || 'Unknown';

                return {
                    id: `vestiaire-${item.id || Math.random().toString().substr(2, 8)}`,
                    title: safeTitle,
                    price: itemPrice || 0, 
                    currency: 'DKK', 
                    image: image || "https://via.placeholder.com/300?text=No+Image",
                    url: itemUrl,
                    source: 'Vestiaire',
                    size: safeSize, 
                    brand: safeBrand,
                    condition: safeCondition,
                    country: safeCountry
                };
            } catch (e) { 
                return null; 
            }
        }).filter(item => item !== null && item.price > 0); 

        const countBeforeFilter = items.length;

        // --- 9. MAGIEN SKER HER ---
        items = applyLocalFilters(items, filters);
        
        console.log(`🇫🇷 Vestiaire: Fandt ${countBeforeFilter} varer -> Godkendt: ${items.length}`);
        
        return { items, total: response.body.pagination?.total || items.length };

    } catch (error) { 
        console.error(`❌ Vestiaire Fejl: ${error.message}`);
        return { items: [], total: 0 }; 
    }
};
