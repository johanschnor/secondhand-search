export const applyLocalFilters = (items, filters) => {
    if (!items || items.length === 0) return [];

    let filteredItems = items.map(item => {
        let cleanItem = { ...item };
        
        if (cleanItem.source && cleanItem.source.toLowerCase() === 'sellpy') {
            
            if (cleanItem.size) {
                cleanItem.size = cleanItem.size.trim().replace(/^INT\s*/i, '');
            }
            
            if (cleanItem.title) {
                cleanItem.title = cleanItem.title.trim().replace(/^INT[A-Z0-9\s]*\s*·\s*/i, '');
            }
            
            if (cleanItem.brand && cleanItem.brand.toUpperCase().startsWith('INT')) {
                const brandNoSpaces = cleanItem.brand.toUpperCase().replace(/\s/g, '');
                if (['INTS', 'INTM', 'INTL', 'INTXL', 'INTXXL'].includes(brandNoSpaces)) {
                    cleanItem.brand = ""; 
                } else {
                    cleanItem.brand = cleanItem.brand.trim().replace(/^INT\s*/i, '');
                }
            }
        }
        return cleanItem;
    });

    const searchQuery = String(filters.q || filters.query || "").toLowerCase();

    const criticalKeywordPlatforms = ['vestiaire', 'ebay', 'grailed', 'momox'];

    let coreKeywords = [];
    if (searchQuery) {
        let coreKeywordsStr = searchQuery
            .replace(/\b(men|women|mand|kvinde|herr|dame|child|kids|børn|unisex)\b/gi, "")
            .replace(/\b(t-shirt|tshirt|tee|shirt|skjorte|sko|shoes|taske|bag|bags|bukser|pants|jeans|hoodie|sweatshirt|strik|knit)\b/gi, "")
            .replace(/\b(xxs|xs|s|m|l|xl|xxl|xxxl|4xl|os|one size)\b/gi, "")
            .trim();

        // Fjern tal (størrelser som 32, 43 osv.)
        coreKeywordsStr = coreKeywordsStr.replace(/\b(\d{2,3}[a-z]*|[a-z]+\d{2,3})\b/gi, "").trim();

        coreKeywords = coreKeywordsStr.split(/\s+/).filter(word => word.length > 2);
    }

    if (coreKeywords.length > 0) {
        filteredItems = filteredItems.filter(item => {
            const sourceLower = (item.source || "").toLowerCase();
            
            // Tjekker KUN platformene på den kritiske liste
            if (criticalKeywordPlatforms.includes(sourceLower)) {
                const titleAndBrand = `${item.title || ""} ${item.brand || ""}`.toLowerCase();
                const hasMatch = coreKeywords.every(word => titleAndBrand.includes(word));
                if (!hasMatch) return false; // Smid ud, hvis kerneordet mangler!
            }
            return true;
        });
    }

    // --- 1. KATEGORI-KIRURGI ---
    let selectedCategories = [];
    if (Array.isArray(filters.kategori)) {
        selectedCategories = filters.kategori.map(c => String(c).toLowerCase());
    } else if (filters.kategori) {
        selectedCategories = [String(filters.kategori).toLowerCase()];
    }

    const wantsShirts = selectedCategories.includes('skjorter') || selectedCategories.includes('shirt') || searchQuery.includes('skjorte') || /\bshirts?\b/.test(searchQuery);
    const wantsTshirts = selectedCategories.some(c => c.includes('t-shirt') || c.includes('tshirt')) || searchQuery.includes('t-shirt') || searchQuery.includes('tshirt') || searchQuery.includes('tee');

    if (wantsShirts && !wantsTshirts) {
        filteredItems = filteredItems.filter(item => {
            const titleLower = (item.title || "").toLowerCase();
            if (/t[\s-]?shirts?/i.test(titleLower)) return false;
            if (/\b(tees?|polos?|sweatshirts?)\b/i.test(titleLower)) return false;
            return true;
        });
    }

    // --- 2. DET FORBEDREDE (OG TILLIDSFULDE) STØRRELSESFILTER ---
    let userSize = filters.size ? filters.size.split(',')[0].trim().toUpperCase().replace(/"/g, '') : null;

    if (!userSize && searchQuery) {
        const sizeMatch = searchQuery.match(/\b(5XL|4XL|3XL|XXXL|XXL|XL|L|M|S|XS|XXS|W\s*[2-4][0-9]|[3-5][0-9](?:\.5)?)\b/i);
        if (sizeMatch) {
            userSize = sizeMatch[1].toUpperCase().replace(/\s+/g, '');
        }
    }
    
    if (userSize) {
        userSize = userSize.replace(',', '.');
        let allowedSizes = [userSize];
        
        // Smarte synonymer for tøj
        if (userSize === 'XS') allowedSizes.push('44', 'X-SMALL', 'XSMALL', 'EXTRA SMALL');
        if (userSize === 'S') allowedSizes.push('46', 'SMALL');
        if (userSize === 'M') allowedSizes.push('48', 'MEDIUM');
        if (userSize === 'L') allowedSizes.push('50', '52', 'LARGE');
        if (userSize === 'XL') allowedSizes.push('54', '56', 'X-LARGE', 'XLARGE');
        if (userSize === 'XXL') allowedSizes.push('58', 'XX-LARGE', 'XXLARGE', '2XL');

        filteredItems = filteredItems.filter(item => {
            const sourceLower = (item.source || "").toLowerCase();
            
            // Din originale VIP liste
            const trustedSizePlatforms = ['kleinanzeigen', 'dba', 'vinted', 'sellpy'];
            
            if (trustedSizePlatforms.includes(sourceLower)) {
                return true; 
            }

            const isNonSizeCategory = 
                selectedCategories.includes('tasker') || 
                selectedCategories.includes('accessories') || 
                /taske|tasker|bag|bags|backpack|accessori/i.test(searchQuery);
            
            if (isNonSizeCategory) return true; 

            const titleLower = (item.title || "").toLowerCase();
            const itemSizeClean = (item.size || "").toUpperCase().trim().replace(',', '.');

            if (userSize === 'ONE SIZE' || userSize === 'OS') {
                if (itemSizeClean === 'ONE SIZE' || itemSizeClean === 'OS') return true;
                if (titleLower.includes('one size') || titleLower.includes('én størrelse') || titleLower.includes('en størrelse')) return true;
                return false;
            }

            if (itemSizeClean) {
                const sizeParts = itemSizeClean.split(/[\s/|(),-]+/);
                const isMatch = allowedSizes.some(s => itemSizeClean === s || sizeParts.includes(s));
                if (isMatch) return true;

                if (!isNaN(parseFloat(userSize))) {
                    if (sizeParts.includes(`W${userSize}`) || sizeParts.includes(`${userSize}W`)) return true;
                    if (itemSizeClean.startsWith(`${userSize}/`)) return true; 
                }
                
                return false; 
            }

            const numSize = parseFloat(userSize);
            if (!isNaN(numSize)) {
                const negativeRegex = new RegExp(`\\b(l|længde|length|uge|vecka|kr|sek|eur)\\s*${numSize}\\b|\\b${numSize}\\s*(kr|sek|eur)\\b|\\b(19|20)${numSize}\\b`, 'i');
                if (negativeRegex.test(titleLower)) {
                    return false;
                }
            }

            const hasTitleMatch = allowedSizes.some(s => {
                if (s === 'L' && titleLower.match(/\b(l|large)\b/)) return true;
                if (s === 'M' && titleLower.match(/\b(m|medium)\b/)) return true;
                if (s === 'S' && titleLower.match(/\b(s|small)\b/)) return true;
                if (s === 'XL' && titleLower.match(/\b(xl|x-large|xlarge)\b/)) return true;
                if (s === 'XXL' && titleLower.match(/\b(xxl|xx-large|2xl|xxlarge)\b/)) return true;
                if (s === 'XS' && titleLower.match(/\b(xs|x-small|xsmall)\b/)) return true;
                
                const escapedSize = s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); 
                if (!isNaN(parseFloat(s)) && titleLower.match(new RegExp(`\\b${escapedSize}\\b|\\bw${escapedSize}\\b|\\b${escapedSize}w\\b|${escapedSize}"`, 'i'))) return true;
                
                return false;
            });

            return hasTitleMatch;
        });
    }

    if (filters.brand) {
        const removeAccents = (str) => {
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        };

        const rawBrandLower = removeAccents(filters.brand.toLowerCase().trim());
        
        filteredItems = filteredItems.filter(item => {
            const titleLower = removeAccents((item.title || "").toLowerCase());
            const itemBrandLower = removeAccents((item.brand || "").toLowerCase());

            if (itemBrandLower.includes(rawBrandLower)) return true;

            const escapedBrand = rawBrandLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const brandRegex = new RegExp(`\\b${escapedBrand}\\b`, 'i');
            
            return brandRegex.test(titleLower);
        });
    }
    return filteredItems;
}
