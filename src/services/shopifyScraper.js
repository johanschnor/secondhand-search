import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import { applyLocalFilters } from '../controllers/itemFilter.js';

// --- KONFIGURATION FOR DE MINDRE SHOPIFY BUTIKKER ---
const SHOPIFY_STORES = {
    marrkt: {
        siteName: 'Marrkt',
        baseUrl: 'https://www.marrkt.com',
        searchPath: '/search?type=product&q=',
        currency: 'GBP',
        country: 'UK'
    },
    secondfootballshirts: {
        siteName: 'Second Football Shirts',
        baseUrl: 'https://www.secondfootballshirts.dk',
        searchPath: '/search?type=product&options%5Bprefix%5D=last&q=',
        currency: 'DKK',
        country: 'DK'
    },
    supersaelger: {
        siteName: 'Supersælger',
        baseUrl: 'https://supersaelger.dk',
        searchPath: '/search?options%5Bprefix%5D=last&q=',
        currency: 'DKK',
        country: 'DK'
    }
};

// --- HJERNE-FUNKTIONEN DER SCRAPER EN VALGFRI SHOPIFY-SIDE ---
export const scrapeShopifyStore = async (storeKey, query, filters = {}) => {
    const store = SHOPIFY_STORES[storeKey];
    if (!store) {
        console.error(`❌ Ukendt Shopify butik: ${storeKey}`);
        return { items: [], total: 0 };
    }

    try {
        const effectiveQuery = (query || filters.brand || '').trim();
        if (!effectiveQuery) return { items: [], total: 0 };

        const page = filters.page || 1;
        
        // ✨ LØSNING: Shopify's søgemaskine er strict. Ved at pakke søgeordet ind i wildcards (*)
        // tvinger vi Shopify til at lede efter delvise matches. Det løser problemet, når 
        // brugeren f.eks. skriver "Stone Island XL" i søgefeltet!
        const shopifyQuery = `*${effectiveQuery}*`;
        
        let searchUrl = `${store.baseUrl}${store.searchPath}${encodeURIComponent(shopifyQuery)}`;
        
        if (page > 1) {
            searchUrl += `&page=${page}`;
        }

        console.log(`🔎 [${store.siteName}] Scraper URL: ${searchUrl}`);

        const response = await gotScraping({
            url: searchUrl,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 115 }],
                devices: ['desktop']
            }
        });

        const $ = cheerio.load(response.body);
        let items = [];
        const seenHandles = new Set();

        $('a[href*="/products/"]').each((i, el) => {
            if (items.length >= (filters.limit || 40)) return false;

            try {
                const linkTag = $(el);
                const href = linkTag.attr('href');
                if (!href) return;

                const handleMatch = href.match(/\/products\/([a-zA-Z0-9_-]+)/);
                if (!handleMatch) return;

                const productHandle = handleMatch[1].split('?')[0];
                if (seenHandles.has(productHandle)) return;

                let cardScope = linkTag.closest('.grid__item, .grid-product, .product-card, .product-item, .product-grid-item, .card-wrapper, .card, article');
                if (!cardScope.length) cardScope = linkTag.parent().parent();

                const rawHtml = cardScope.html() || '';

                // 1. BILLEDE & TITEL EXTRACTOR
                let imageSrc = '';
                let cleanTitle = '';

                const noscriptHtml = cardScope.find('noscript').html();
                if (noscriptHtml) {
                    const nsImgMatch = noscriptHtml.match(/src="([^"]+)"/i);
                    if (nsImgMatch) imageSrc = nsImgMatch[1];
                    
                    const nsAltMatch = noscriptHtml.match(/alt="([^"]+)"/i);
                    if (nsAltMatch) cleanTitle = nsAltMatch[1];
                }

                if (!imageSrc || imageSrc.startsWith('data:image')) {
                    const imgTags = cardScope.find('img');
                    imgTags.each((_, imgEl) => {
                        if (imageSrc && !imageSrc.startsWith('data:image')) return; 
                        const img = $(imgEl);
                        
                        const srcset = img.attr('data-srcset') || img.attr('srcset') || '';
                        if (srcset) {
                             const srcParts = srcset.split(',').map(s => s.trim().split(' ')[0]).filter(s => s.includes('//'));
                             if (srcParts.length > 0) imageSrc = srcParts[srcParts.length - 1]; 
                        }
                        
                        if (!imageSrc || imageSrc.startsWith('data:image')) {
                            imageSrc = img.attr('data-src') || img.attr('src') || '';
                        }
                        
                        if (!cleanTitle) cleanTitle = img.attr('alt') || '';
                    });
                }

                if (imageSrc && imageSrc.startsWith('//')) {
                    imageSrc = 'https:' + imageSrc;
                }

                cardScope.find('style, noscript, script').remove();

                // 2. TITEL EXTRACTOR
                let title = cardScope.find('.product-item__title, .product-card__title, .grid-product__title, .card-information__text, .card__heading, .product__title, h2, h3, h4, .title').first().text().trim();
                
                if (!title) title = cleanTitle; 

                if (!title || title.includes('{')) {
                    const altRegexMatch = rawHtml.match(/alt="([^"{}]+)"/i);
                    if (altRegexMatch && altRegexMatch[1].length > 2) {
                        title = altRegexMatch[1].trim();
                    }
                }
                
                if (!title || title.includes('{')) {
                    title = linkTag.text().trim().replace(/\s+/g, ' ');
                }
                
                if (!title || title.length < 3 || title.includes('{')) return; 

                // 3. PRIS EXTRACTOR
                const priceText = cardScope.find('.price, .product-price, .current-price, .money, span:contains("kr"), span:contains("£")').text();
                let price = 0;
                const priceMatch = priceText.match(/[\d.,]+/);

                if (priceMatch) {
                    let cleanPrice = priceMatch[0];
                    if (cleanPrice.includes(',') && cleanPrice.includes('.')) {
                        cleanPrice = cleanPrice.replace(/\./g, '').replace(',', '.');
                    } else if (cleanPrice.includes(',')) {
                        cleanPrice = cleanPrice.replace(',', '.');
                    }
                    price = Math.round(parseFloat(cleanPrice));
                }

                // 4. BRAND EXTRACTOR
                let brand = filters.brand || '';
                if (!brand) {
                    const vendorText = cardScope.find('.vendor, .product-vendor, .brand, .product-item__vendor').text().trim();
                    brand = vendorText || title.split(' ')[0];
                }

                // 5. STØRRELSE EXTRACTOR
                let size = '';
                const sizeLabel = cardScope.find('.size, .product-size, .variant__label, [data-option-name="Size"], .badge--size').text().trim();
                if (sizeLabel && sizeLabel.length > 0 && sizeLabel.length < 10) {
                    size = sizeLabel;
                }
                
                if (!size) {
                    const sizeRegex = /(?:-|\||,|\sstr\.?|\ssize|\s)\s*(XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|\b[3-5][0-9]\b)\s*$/i;
                    const sizeMatch = title.match(sizeRegex);
                    if (sizeMatch) {
                        size = sizeMatch[1].toUpperCase();
                        title = title.replace(sizeMatch[0], '').trim();
                    }
                }

                seenHandles.add(productHandle);

                items.push({
                    id: `${storeKey}-${productHandle}`,
                    title: title,
                    price: price,
                    currency: store.currency,
                    image: imageSrc,
                    url: href.startsWith('http') ? href : `${store.baseUrl}${href}`,
                    source: store.siteName,
                    brand: brand,
                    size: size,
                    country: store.country
                });

            } catch (err) {
                // Ignorer enkeltfejl
            }
        });

        items = items.filter(item => item.price > 0 && item.image !== '');
        items = applyLocalFilters(items, filters);

        return { items, total: items.length };

    } catch (error) {
        console.error(`❌ [${store.siteName}] Scrape fejl:`, error.message);
        return { items: [], total: 0 };
    }
};

export const marrktService = {
    name: 'Marrkt',
    service: { search: (query, filters) => scrapeShopifyStore('marrkt', query, filters) }
};

export const secondFootballShirtsService = {
    name: 'Second Football Shirts',
    service: { search: (query, filters) => scrapeShopifyStore('secondfootballshirts', query, filters) }
};

export const supersaelgerService = {
    name: 'Supersælger',
    service: { search: (query, filters) => scrapeShopifyStore('supersaelger', query, filters) }
};
