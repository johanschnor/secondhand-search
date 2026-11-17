import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

// Vi trækker på dine eksakte opslagsværker og det nye globale filter!
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { SIZE_MAP } from '../controllers/sizeMap.js';
import { applyLocalFilters } from '../controllers/itemFilter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const EBAY_API_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID;

let accessToken = null;
let tokenExpiresAt = 0;

// --- HJÆLPERE ---
const getHighResImage = (url) => {
    if (!url) return "";
    if (url.includes('ebayimg.com')) {
        return url.replace(/s-l\d+/i, "s-l500");
    }
    return url;
};

const extractSize = (title) => {
    if (!title) return "";
    const jeansMatch = title.match(/\b(?:W|str\.?)?\s*([0-9]{2})\/[0-9]{2}\b/i);
    if (jeansMatch) return jeansMatch[1];
    const match = title.match(/\b(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS|[0-9]{2}(?:\.[5])?)\b/i);
    if (match) return match[1].toUpperCase();
    return "";
};

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Failed to get eBay OAuth token");
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return accessToken;
}

// 🔍 HOVEDFUNKTION
export const search = async (query, filters = {}) => {
  try {
    const token = await getAccessToken();
    
    const limitPerMarketplace = filters.limit && filters.limit <= 10 ? 5 : 30;
      
    let baseUrl = `${EBAY_API_URL}?limit=${limitPerMarketplace}`;
    if (filters.page && filters.page > 1) {
        baseUrl += `&offset=${(filters.page - 1) * limitPerMarketplace}`;
    }

    let effectiveQuery = (query || '').trim();

    // --- 1. KØN OVERSÆTTER ---
    const rawGender = Array.isArray(filters.kon) ? filters.kon[0] : (filters.kon || '');
    const genderString = String(rawGender).toLowerCase();
    
    let genderKey = null; 
    let targetCategory = '11450'; // Standard Tøj/Sko
    
    if (['men', 'mand', 'mænd', 'herr'].some(g => genderString.includes(g))) {
        genderKey = 'male';
        targetCategory = '1059'; 
    } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
        genderKey = 'female';
        targetCategory = '15724'; 
    }
    
    // --- 2. KATEGORI OVERSÆTTER ---
    let categoryName = null;
    const rawCategory = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId);
    if (typeof rawCategory === 'object' && rawCategory !== null) {
        categoryName = rawCategory.label || rawCategory.value || String(rawCategory);
    } else if (rawCategory) {
        categoryName = String(rawCategory).split(',')[0].trim();
    }

    if (categoryName && categoryName !== 'Alle') {
        if (!isNaN(categoryName)) {
            targetCategory = categoryName;
        } else if (CATEGORY_MAP[categoryName]) {
            const lookupGender = genderKey || 'male'; 
            targetCategory = CATEGORY_MAP[categoryName]?.[lookupGender]?.ebay || targetCategory;
        }
    }

    // --- 3. AUTO-DETEKTOR FOR STØRRELSE I FRITEKST ---
    let userSize = filters.size ? filters.size.split(',')[0].trim().toUpperCase() : null;
    if (!userSize) {
        const sizeMatch = effectiveQuery.match(/\b(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS|W\s*[2-4][0-9]|[3-5][0-9](?:[.,]5)?)\b/i);
        if (sizeMatch) {
            userSize = sizeMatch[1].toUpperCase().replace(/\s+/g, '');
            effectiveQuery = effectiveQuery.replace(sizeMatch[0], '').trim();
        }
    }

    // --- 4. BYGGER SUPER-SØGETEKSTEN (ENGELSK) ---
    effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women|child)\b/gi, '').trim();
    
    let searchTerms = [];
    if (effectiveQuery) searchTerms.push(effectiveQuery);
    if (filters.brand) searchTerms.push(filters.brand);

    // SKIFTET TIL ENGELSK: De engelske termer virker bedst på tværs af Europa!
    const categoryTextMap = {
        "Overtøj": "Jacket Coat", 
        "Sweats": "Hoodie Sweatshirt", 
        "Jeans": "Jeans",
        "Bukser": "Pants Trousers", 
        "T-shirts": "T-Shirt Tee", 
        "Skjorter": "Shirt", 
        "Strik": "Knit Sweater", 
        "Sko": "Shoes Sneakers Boots", 
        "Accessories": "Accessories", 
        "Tasker": "Bag Backpack"
    };
    
    if (categoryName && categoryName !== 'Alle' && isNaN(categoryName)) {
        searchTerms.push(categoryTextMap[categoryName] || categoryName);
    }

    if (userSize) {
         let sizeStr = userSize;
         const numSize = parseFloat(userSize);
         if ((categoryName === 'Jeans' || categoryName === 'Bukser') && !isNaN(numSize)) {
             sizeStr = `W${numSize}`; 
         }
         if (!searchTerms.some(part => part.toUpperCase().includes(userSize))) {
            searchTerms.push(sizeStr);
         }
    }

    const finalSearchText = [...new Set(searchTerms.join(' ').split(' '))].filter(w => w).join(' ');

    if (finalSearchText.length > 0) {
      baseUrl += `&q=${encodeURIComponent(finalSearchText)}`;
    }

    baseUrl += `&category_ids=${targetCategory}`;

  // --- 5. FILTRE (Pris, Stand, Land) ---
    let filterParts = [];
    
    // Vi søger kun i Europa for at spare brugerne for grimme told-regninger
    const euCountries = "DE|FR|IT|ES|NL|PL|BE|AT|SE|DK|IE|PT|FI|CZ";
    filterParts.push(`itemLocationCountry:{${euCountries}}`);

    // FJERNET: priceCurrency:DKK. (Det fik eBay til at ignorere vores landefilter og vise Japan)

    if (filters.minPrice || filters.maxPrice) {
      const min = filters.minPrice ? Math.floor(filters.minPrice / 7.46) : 0;
      const max = filters.maxPrice ? Math.ceil(filters.maxPrice / 7.46) : 100000;
      filterParts.push(`price:[${min}..${max}]`);
    }

    if (filters.condition) {
        const cond = Array.isArray(filters.condition) ? filters.condition[0] : filters.condition;
        if (cond === 'new' || cond === 'new tags') filterParts.push(`conditionIds:{1000|1500}`); 
        else if (cond === 'used' || cond === 'good') filterParts.push(`conditionIds:{3000}`); 
    }

    if (filterParts.length > 0) {
        baseUrl += `&filter=${filterParts.join(',')}`;
    }

    if (filters.sortBy === "price_asc") baseUrl += `&sort=price`;
    else if (filters.sortBy === "price_desc") baseUrl += `&sort=-price`;
    else if (filters.sortBy === "newly_listed" || !finalSearchText) baseUrl += `&sort=-list_date`; 

    // --- 6. PARALLEL FETCH (DEN MAGISKE EU-MASKINE) ---
    // Vi kalder eBays 6 største EU markeder samtidigt.
   const euMarketplaces = ["EBAY_DE", "EBAY_FR", "EBAY_IT", "EBAY_ES", "EBAY_NL", "EBAY_IE"];
    
    console.log(`🌍 eBay (Pan-EU) Request: "${finalSearchText}" | Kat: ${targetCategory}`);

    // Byg endUserCtx med affiliate data, hvis vi har et Campaign ID
    const endUserCtx = EBAY_CAMPAIGN_ID 
        ? `contextualLocation=DK,affiliateCampaignId=${EBAY_CAMPAIGN_ID},affiliateReferenceId=OFFLIST` 
        : "contextualLocation=DK";

    const fetchPromises = euMarketplaces.map(marketplaceId => {
        return fetch(baseUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
                "X-EBAY-C-ENDUSERCTX": endUserCtx // Opdateret header her!
            },
        }).then(res => res.json()).catch(() => null);
    });

    const responses = await Promise.all(fetchPromises);

    let rawItems = [];
    const seenIds = new Set(); // Holder styr på dem vi allerede har set

    responses.forEach(data => {
        if (data && data.itemSummaries) {
            data.itemSummaries.forEach(item => {
                if (!seenIds.has(item.itemId)) {
                    seenIds.add(item.itemId); // Sørger for varen ikke vises 2 gange
                    rawItems.push(item);
                }
            });
        }
    });

    if (rawItems.length === 0) return { items: [], total: 0 };

    let items = rawItems.map((item) => {
      let image = item.image?.imageUrl || '';
      if (!image && item.thumbnailImages?.[0]) image = item.thumbnailImages[0].imageUrl;
      image = getHighResImage(image);
      let size = extractSize(item.title);

      return {
        id: `ebay-${item.itemId}`,
        title: item.title,
        price: item.price?.value ? Number(item.price.value) : 0,
        currency: item.price?.currency || 'EUR',
        image: image,
        url: item.itemAffiliateWebUrl || item.itemWebUrl, 
        source: "eBay",
        country: item.itemLocation?.country || 'EU',
        size: size,
        brand: filters.brand || '', 
        condition: item.condition || 'Brugt'
      };
    });
    const countBeforeFilter = items.length;

    // --- 8. DIN LOKALE BOUNCER ---
    items = applyLocalFilters(items, filters);

    console.log(`🇪🇺 eBay (Pan-EU): Fandt ${countBeforeFilter} unikke varer -> Godkendt: ${items.length}`);
    return { items, total: items.length };

  } catch (err) {
    console.error("❌ eBay search error:", err.message);
    return { items: [], total: 0 };
  }
};
