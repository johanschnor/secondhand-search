import axios from 'axios';
import { CATEGORY_MAP } from '../controllers/categoryMap.js';
import { applyLocalFilters } from '../controllers/itemFilter.js';

const TRADERA_ID = process.env.TRADERA_APP_ID;
const TRADERA_KEY = process.env.TRADERA_APP_KEY;

const getHighResImage = (url) => {
    if (!url) return "https://via.placeholder.com/300?text=No+Image";
    let cleanUrl = url.split('?')[0];
    if (cleanUrl.includes('tradera.net')) {
        cleanUrl = cleanUrl.replace(/\/(small|medium|large)(?:-fit)?\//i, "/large-fit/");    
    }
    return cleanUrl;
};

// Hjælpefunktion til at trække værdier ud af JSON-objekter uanset struktur
const extractJsonValue = (obj) => {
    if (!obj) return "";
    if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
    if (Array.isArray(obj)) return extractJsonValue(obj[0]);
    if (typeof obj === 'object') {
        const keys = Object.keys(obj);
        if (keys.length > 0) return extractJsonValue(obj[keys[0]]);
    }
    return "";
};

export const search = async (query, filters = {}) => {
    try {
        let effectiveQuery = (query || '').trim();
        const pageNum = filters.page || 1;        
        let traderaOrderBy = "EndDateDescending"; 
        if (filters.sortBy === 'price_asc') traderaOrderBy = "PriceAscending";
        if (filters.sortBy === 'price_desc') traderaOrderBy = "PriceDescending";
        if (filters.sortBy === 'relevance') traderaOrderBy = "Relevance";

        // --- 1. KØN OVERSÆTTER (Skudsikker) ---
        let rawGender = Array.isArray(filters.kon) ? filters.kon[0] : filters.kon;
        if (rawGender === undefined || rawGender === null) {
            rawGender = '';
        }
        
        const genderString = rawGender.toString().toLowerCase();
        
        let genderKey = null; 
        let finalCategoryId = 16; // Default: Tøj & Sko (Blandet)

        if (['men', 'male', 'mænd', 'mand', 'herr'].some(g => genderString.includes(g))) {
            genderKey = 'male';
            finalCategoryId = 302074; 
        } else if (['women', 'female', 'kvinder', 'dame'].some(g => genderString.includes(g))) {
            genderKey = 'female';
            finalCategoryId = 302073; 
        } 
        
        // --- 2. KATEGORI OVERSÆTTER ---
        const rawCategory = Array.isArray(filters.kategori) ? filters.kategori[0] : (filters.kategori || filters.categoryId);
        const categoryName = rawCategory ? rawCategory.split(',')[0].trim() : null;

        if (categoryName && categoryName !== 'Alle') {
            if (!isNaN(categoryName)) {
                finalCategoryId = parseInt(categoryName);
            } else if (CATEGORY_MAP[categoryName]) {
                const lookupGender = genderKey || 'male'; 
                finalCategoryId = CATEGORY_MAP[categoryName]?.[lookupGender]?.tradera || finalCategoryId;
            }
        }

        // --- 3. AUTO-DETEKTOR FOR STØRRELSE I FRITEKST ---
        let userSize = filters.size ? String(filters.size).split(',')[0].trim().toUpperCase() : null;
        
        if (!userSize) {
            const sizeMatch = effectiveQuery.match(/\b(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS|W\s*[2-4][0-9]|[3-5][0-9](?:[.,]5)?)\b/i);
            if (sizeMatch) {
                userSize = sizeMatch[1].toUpperCase().replace(/\s+/g, '');
                effectiveQuery = effectiveQuery.replace(sizeMatch[0], '').trim();
            }
        }

        // --- 4. AUTO-DETEKTOR FOR ACCESSORIES ---
        if (!categoryName && [16, 1603, 1604].includes(finalCategoryId) && effectiveQuery) {
            const accessoryKeywords = ['taske', 'tasker', 'bag', 'bags', 'backpack', 'rygsæk', 'pung', 'purse', 'wallet', 'clutch', 'solbriller', 'briller', 'sunglasses', 'glasses', 'shades', 'bælte', 'bælter', 'belt', 'belts', 'hue', 'huer', 'kasket', 'kasketter', 'hat', 'hats', 'cap', 'caps', 'beanie', 'beanies', 'hovedbeklædning', 'headwear', 'balaclava', 'handske', 'handsker', 'glove', 'gloves', 'vante', 'vanter', 'halstørklæde', 'tørklæde', 'scarf', 'scarves', 'ur', 'ure', 'watch', 'watches', 'smykke', 'smykker', 'jewelry', 'jewellery', 'ring', 'halskæde', 'necklace', 'armbånd', 'bracelet'];
            const eqLower = effectiveQuery.toLowerCase();
            const hasAccessory = accessoryKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(eqLower));
            
            if (hasAccessory) {
                finalCategoryId = 0; 
                console.log(`🇸🇪 Auto-Detect: Fritekst indeholder accessory. Skifter Tradera kategori til 0.`);
            }
        }

        // --- 5. BYG DEN ULTIMATIVE TRADERA FRITEKST SØGNING ---
        effectiveQuery = effectiveQuery.replace(/\b(herr|dame|mænd|kvinder|men|women)\b/gi, '').trim();
        
        let searchParts = [];
        if (effectiveQuery) searchParts.push(effectiveQuery);
        
        if (filters.brand && !effectiveQuery.toLowerCase().includes(String(filters.brand).toLowerCase())) {
            searchParts.push(String(filters.brand).trim());
        }

        if (userSize) {
             let sizeStr = userSize;
             const numSize = parseFloat(userSize);
             
             if ((categoryName === 'Jeans' || categoryName === 'Bukser') && !isNaN(numSize)) {
                 sizeStr = `W${numSize}`;
             }

             if (!searchParts.some(part => part.toUpperCase().includes(userSize))) {
                searchParts.push(sizeStr);
             }
        }

        let rawQueryString = searchParts.join(' ').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const finalQueryString = [...new Set(rawQueryString.split(/\s+/))].join(' ').trim();

        const response = await axios.get('https://api.tradera.com/v4/search', {
            params: {
                query: finalQueryString,
                categoryId: finalCategoryId,
                pageNumber: pageNum,
                page: pageNum,
                offset: (pageNum - 1) * 50,

                orderBy: traderaOrderBy,
                limit: 50
            },
            headers: {
                'X-App-Id': TRADERA_ID,
                'X-App-Key': TRADERA_KEY,
                'Accept': 'application/json'
            },
            timeout: 10000 
        });

        // Slut med tung XML! Vi arbejder direkte med lækkert JSON:
        const data = response.data;
        
        // Tager højde for, om Tradera pakker det ind i 'items' eller 'searchResult' i det nye API
        let rawItems = data.items || (data.searchResult && data.searchResult.items) || [];
        
        if (!rawItems || rawItems.length === 0) {
            console.log(`🇸🇪 Tradera (REST v4): Returnerede ingen varer for query "${finalQueryString}".`);
            return { items: [], total: 0 };
        }

        const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];
        const safeItemsArray = itemsArray.slice(0, 50);

        let items = safeItemsArray.filter(item => item && (item.id || item.Id)).map(item => {
            let size = "";
            let brand = filters.brand || ""; 
            let condition = "Brugt";         

            // Tager højde for både camelCase (ny) og PascalCase (gammel XML format), for at være skudsikker
            const itemId = item.id || item.Id;
            const title = item.shortDescription || item.ShortDescription;
            const buyItNowPrice = item.buyItNowPrice || item.BuyItNowPrice;
            const maxBid = item.maxBid || item.MaxBid;
            const nextBid = item.nextBid || item.NextBid;
            const bidCount = item.bidCount || item.BidCount || 0;
            const itemUrl = item.itemUrl || item.ItemUrl || `https://www.tradera.com/item/${itemId}`;
            const itemType = item.itemType || item.ItemType;
            const thumbnailLink = item.thumbnailLink || item.ThumbnailLink;

            // Smart rekursiv søgning: Leder alle afkroge af attributterne igennem for at finde de rigtige data
            const findAttributes = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                
                if (Array.isArray(obj)) {
                    obj.forEach(findAttributes);
                    return;
                }

                const name = obj.name || obj.Name;
                const values = obj.values || obj.Values || obj.value || obj.Value;

                if (name && values) {
                    const extractedValue = extractJsonValue(values);
                    if (extractedValue) {
                        const nameLower = String(name).toLowerCase();
                        if (nameLower.includes("storlek") || nameLower.includes("size")) size = extractedValue;
                        else if (nameLower.includes("märke") || nameLower.includes("brand")) brand = extractedValue;
                        else if (nameLower.includes("skick") || nameLower.includes("condition")) condition = extractedValue;
                    }
                }
                
                Object.values(obj).forEach(findAttributes);
            };

            findAttributes(item.attributeValues || item.AttributeValues || item.attributes || item.Attributes);

            // Billedhåndtering for det nye JSON format
            let rawImageUrl = thumbnailLink;
            const imageLinks = item.imageLinks || item.ImageLinks;
            if (imageLinks) {
                const links = imageLinks.imageLink || imageLinks.ImageLink || imageLinks;
                if (Array.isArray(links) && links.length > 0) {
                    rawImageUrl = links[0].url || links[0].Url || rawImageUrl;
                } else if (links && (links.url || links.Url)) {
                    rawImageUrl = links.url || links.Url;
                }
            }

            if (userSize) {
                const titleUpper = (title || "").toUpperCase();
                const sizeUpper = size.toUpperCase();
                const escapedSize = userSize.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                const sizeRegex = new RegExp(`\\b${escapedSize}\\b|\\bW${escapedSize}\\b|${escapedSize}W\\b|${escapedSize}"`, 'i');

                if (sizeRegex.test(titleUpper) || sizeRegex.test(sizeUpper)) {
                    size = userSize; 
                }
            }

            return {
                id: `tradera-${itemId}`,
                title: title,
                price: buyItNowPrice || maxBid || nextBid || 0,
                currentBid: maxBid || null,
                buyItNowPrice: buyItNowPrice || null,
                totalBids: bidCount,
                currency: 'SEK',
                image: getHighResImage(rawImageUrl),
                url: itemUrl,
                source: 'Tradera',
                country: 'SE',
                size: size,
                brand: brand,
                condition: condition,
                itemType: itemType 
            };
        });

        const countBeforeFilter = items.length;

        // --- MAGIEN SKER HER ---
        items = applyLocalFilters(items, filters);

        const totalItems = data.totalNumberOfItems || data.TotalNumberOfItems || (data.searchResult && data.searchResult.totalNumberOfItems) || items.length;

        console.log(`🇸🇪 Tradera (REST v4): Kat ${finalCategoryId}, Query: "${finalQueryString}" | Fandt: ${countBeforeFilter} -> Godkendt: ${items.length}`);
        
        return { items, total: totalItems };

    } catch (error) {
        console.error(`❌ Tradera Fejl: ${error.message}`);
        return { items: [], total: 0 };
    }
};
