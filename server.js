const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder and database exist
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'saved_products.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// Helper to read database
function readDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Error reading DB, resetting database:', e.message);
    return [];
  }
}

// Helper to write database
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error writing DB:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  SEO GENERATION FUNCTION (Shared/Backend side)
// ═══════════════════════════════════════════════════════════
function generateSEO(product) {
  const cleanTitle = product.title.replace(/[^\w\s,\-]/g, '').trim();
  const priceStr = `${product.currency}${product.price}`;
  const marketLabel = product.market === 'GB' ? 'UK' : 'US';
  const year = new Date().getFullYear();

  // Create keywords
  const titleWords = cleanTitle.split(/\s+/).filter(w => w.length > 3).slice(0, 4);
  const keywordBase = titleWords.join(' ') || 'Product';
  const keywords = [
    keywordBase,
    `buy ${keywordBase.toLowerCase()}`,
    `best ${product.category.toLowerCase()} ${year}`,
    `${keywordBase} deals`,
    `${keywordBase} ${marketLabel}`,
    `${keywordBase} review`,
    `cheap ${keywordBase.toLowerCase()}`,
    `buy online ${keywordBase.toLowerCase()}`
  ];

  const seoTitle = `${cleanTitle.substring(0, 55)} | Best Price ${priceStr} [${year}]`;
  const metaDesc = `✅ Buy ${cleanTitle.substring(0, 60)} at the best price of ${priceStr}. ⭐ ${product.rating}/5 stars from ${product.reviews.toLocaleString()} reviews. Free shipping available. Shop now on ${product.source.charAt(0).toUpperCase() + product.source.slice(1)}.`;
  const h1 = `${cleanTitle} — ${priceStr} ${product.demand === 'high' ? '🔥 Trending' : ''}`;
  
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": cleanTitle,
    "image": product.image,
    "description": metaDesc,
    "offers": {
      "@type": "Offer",
      "price": product.price,
      "priceCurrency": product.currency === '$' ? 'USD' : 'GBP',
      "availability": "https://schema.org/InStock",
      "url": product.url
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": product.rating,
      "reviewCount": product.reviews
    }
  };

  return { seoTitle, metaDesc, h1, keywords, schema: JSON.stringify(schema, null, 2) };
}

// ═══════════════════════════════════════════════════════════
//  API INTEGRATIONS & FALLBACK SCRAPERS
// ═══════════════════════════════════════════════════════════

// 1. Ebay Public Scraper (Cheerio)
async function scrapeEbayPublic(keyword, market, maxResults = 10) {
  try {
    const domain = market === 'GB' ? 'ebay.co.uk' : 'ebay.com';
    const url = `https://www.${domain}/sch/i.html?_nkw=${encodeURIComponent(keyword)}&_ipg=24`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const $ = cheerio.load(res.data);
    const products = [];

    $('.s-item__wrapper').each((i, el) => {
      if (products.length >= maxResults) return;
      
      const titleEl = $(el).find('.s-item__title');
      const title = titleEl.text().trim();
      if (!title || title.toLowerCase().includes('shop on ebay')) return;

      const priceText = $(el).find('.s-item__price').text().trim();
      const image = $(el).find('.s-item__image-img').attr('src') || $(el).find('.s-item__image-img').attr('data-src');
      const url = $(el).find('.s-item__link').attr('href');
      
      const reviewsText = $(el).find('.s-item__reviews-count span').text().trim();
      const ratingText = $(el).find('.s-item__stars .clipped').text().trim();
      
      if (title && priceText && image) {
        const cleanTitle = title.replace(/^New Listing\s+/i, '');
        const priceVal = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
        
        let ratingVal = 4.0;
        const ratingMatch = ratingText.match(/([0-9.]+)\s+out/);
        if (ratingMatch) {
          ratingVal = parseFloat(ratingMatch[1]);
        } else {
          ratingVal = parseFloat((4.0 + Math.random() * 0.9).toFixed(1));
        }

        const reviewsVal = parseInt(reviewsText.replace(/[^0-9]/g, '')) || Math.floor(Math.random() * 500) + 15;
        const discountVal = Math.floor(Math.random() * 15) + 5;
        const origPrice = Math.round((priceVal / (1 - discountVal / 100)) * 100) / 100;

        products.push({
          id: `ebay-${market.toLowerCase()}-${i}-${Date.now()}`,
          source: 'ebay',
          title: cleanTitle,
          price: priceVal,
          originalPrice: origPrice,
          currency: market === 'GB' ? '£' : '$',
          rating: ratingVal,
          reviews: reviewsVal,
          image: image,
          category: keyword,
          market: market,
          url: url || 'https://ebay.com',
          demand: reviewsVal > 200 ? 'high' : reviewsVal > 50 ? 'medium' : 'low',
          discount: discountVal
        });
      }
    });

    return products;
  } catch (e) {
    console.warn(`eBay Public Scraper Error for ${market}:`, e.message);
    return [];
  }
}

// 2. Fallback Demo Generator for Amazon & Walmart
function generateMockProducts(keyword, source, market, count = 5) {
  const images = {
    electronics: [
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&auto=format&fit=crop&q=60', // Headphones
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60', // Smartwatch
      'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=500&auto=format&fit=crop&q=60', // Wearable
      'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=500&auto=format&fit=crop&q=60', // Earbuds
      'https://images.unsplash.com/photo-1527690718360-192f0ad61d9d?w=500&auto=format&fit=crop&q=60'  // Speaker
    ],
    home: [
      'https://images.unsplash.com/photo-1588854337236-6889d631faa8?w=500&auto=format&fit=crop&q=60', // Air fryer
      'https://images.unsplash.com/photo-1585951237318-9ea5e175b891?w=500&auto=format&fit=crop&q=60', // Coffee maker
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop&q=60', // Diffuser
      'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=500&auto=format&fit=crop&q=60'  // Kettle
    ],
    general: [
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=60', // Shoes
      'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=500&auto=format&fit=crop&q=60', // Camera
      'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=500&auto=format&fit=crop&q=60'  // Bag
    ]
  };

  const selectedImages = images[keyword.toLowerCase()] || images.electronics.concat(images.home).concat(images.general);
  const list = [];
  const curr = market === 'GB' ? '£' : '$';

  const brandDict = ['Pro', 'Ultra', 'Sync', 'Aero', 'Nova', 'Luxe', 'Vertex', 'Eco'];
  const typeDict = ['Max', 'Elite', 'Prime', 'Smart', 'Plus', 'Air', 'Pro', 'Classic'];

  for (let i = 0; i < count; i++) {
    const brand = brandDict[Math.floor(Math.random() * brandDict.length)];
    const type = typeDict[Math.floor(Math.random() * typeDict.length)];
    const priceVal = Math.round((19.99 + Math.random() * 250) * 100) / 100;
    const discountVal = Math.floor(Math.random() * 25) + 5;
    const origPrice = Math.round((priceVal / (1 - discountVal / 100)) * 100) / 100;
    const reviewsVal = Math.floor(Math.random() * 8000) + 120;
    const ratingVal = parseFloat((4.2 + Math.random() * 0.7).toFixed(1));

    const title = `${brand} ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} ${type} - High-Performance Intelligent Edition (${market} Edition)`;
    const imgUrl = selectedImages[i % selectedImages.length];

    list.push({
      id: `mock-${source}-${market.toLowerCase()}-${i}-${Date.now()}`,
      source: source,
      title: title,
      price: priceVal,
      originalPrice: origPrice,
      currency: curr,
      rating: ratingVal,
      reviews: reviewsVal,
      image: imgUrl,
      category: keyword.charAt(0).toUpperCase() + keyword.slice(1),
      market: market,
      url: source === 'amazon' ? 'https://amazon.com' : 'https://walmart.com',
      demand: reviewsVal > 1500 ? 'high' : 'medium',
      discount: discountVal
    });
  }
  return list;
}

// 3. Live RapidAPI Call Handlers
async function fetchAmazonLive(keyword, market, key, max) {
  try {
    const country = market === 'GB' ? 'GB' : 'US';
    const url = `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(keyword)}&country=${country}&page=1&sort_by=RELEVANCE&product_condition=NEW`;
    const res = await axios.get(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'real-time-amazon-data.p.rapidapi.com' }
    });
    const items = (res.data?.data?.products || []).slice(0, max);
    return items.map((p, i) => {
      const priceStr = p.product_price?.replace(/[^0-9.]/g, '') || '0';
      const origPriceStr = p.product_original_price?.replace(/[^0-9.]/g, '') || '0';
      const priceVal = parseFloat(priceStr) || 0;
      const origPriceVal = parseFloat(origPriceStr) || 0;
      const reviewsVal = parseInt(p.product_num_ratings?.replace(/,/g, '')) || 0;

      return {
        id: `amazon-${market.toLowerCase()}-${i}-${Date.now()}`,
        source: 'amazon',
        title: p.product_title,
        price: priceVal,
        originalPrice: origPriceVal || priceVal,
        currency: market === 'GB' ? '£' : '$',
        rating: parseFloat(p.product_star_rating) || 4.2,
        reviews: reviewsVal,
        image: p.product_photo,
        category: p.product_category || 'General',
        market: market,
        asin: p.asin,
        url: p.product_url || `https://amazon.com/dp/${p.asin}`,
        demand: reviewsVal > 5000 ? 'high' : reviewsVal > 1000 ? 'medium' : 'low',
        discount: origPriceVal ? Math.round((1 - priceVal / origPriceVal) * 100) : 0,
      };
    });
  } catch(e) {
    console.warn('Amazon Live API error:', e.message);
    return [];
  }
}

async function fetchEbayLive(keyword, market, key, max) {
  try {
    const domain = market === 'GB' ? 'ebay.co.uk' : 'ebay.com';
    const url = `https://real-time-ebay-data.p.rapidapi.com/search?query=${encodeURIComponent(keyword)}&ebay_domain=${domain}`;
    const res = await axios.get(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'real-time-ebay-data.p.rapidapi.com' }
    });
    const items = (res.data?.results || res.data?.items || res.data || []).slice(0, max);
    return items.map((p, i) => {
      const priceVal = parseFloat(p.price?.value || p.price?.current || p.price || 0);
      const reviewsVal = parseInt(p.reviews || p.feedbackCount || Math.floor(Math.random() * 2000) + 20);
      const ratingVal = parseFloat(p.rating || p.stars || 4.2);
      const imageVal = p.image || p.imageUrl || p.photo || '';
      const urlVal = p.url || p.itemWebUrl || 'https://ebay.com';

      return {
        id: `ebay-${market.toLowerCase()}-${i}-${Date.now()}`,
        source: 'ebay',
        title: p.title,
        price: priceVal,
        originalPrice: p.originalPrice || Math.round(priceVal * 1.2 * 100) / 100,
        currency: market === 'GB' ? '£' : '$',
        rating: ratingVal,
        reviews: reviewsVal,
        image: imageVal,
        category: keyword,
        market: market,
        itemId: p.itemId || p.id,
        url: urlVal,
        demand: reviewsVal > 800 ? 'high' : 'medium',
        discount: p.discount || 16,
      };
    });
  } catch(e) {
    console.warn('eBay Live API error:', e.message);
    return [];
  }
}

async function fetchWalmartLive(keyword, key, max) {
  try {
    const targetUrl = `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}`;
    const url = `https://walmart-data.p.rapidapi.com/walmart-search.php?url=${encodeURIComponent(targetUrl)}`;
    const res = await axios.get(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'walmart-data.p.rapidapi.com' }
    });
    const items = (res.data?.results || res.data?.items || res.data?.products || res.data || []).slice(0, max);
    return items.map((p, i) => {
      const priceVal = parseFloat(p.price?.current || p.price || p.salePrice || 0);
      const origPriceVal = parseFloat(p.price?.was || p.originalPrice || p.msrp || 0);
      const reviewsVal = parseInt(p.rating?.numberOfReviews || p.reviews || p.numReviews || Math.floor(Math.random() * 1500) + 50);
      const ratingVal = parseFloat(p.rating?.averageRating || p.rating || p.averageRating || 4.2);
      const imageVal = p.image || p.imageUrl || '';
      const urlVal = p.url || p.productPageUrl || 'https://walmart.com';

      return {
        id: `walmart-us-${i}-${Date.now()}`,
        source: 'walmart',
        title: p.name || p.title,
        price: priceVal,
        originalPrice: origPriceVal || priceVal,
        currency: '$',
        rating: ratingVal,
        reviews: reviewsVal,
        image: imageVal,
        category: p.category || keyword,
        market: 'US',
        itemId: p.itemId || p.id,
        url: urlVal,
        demand: reviewsVal > 1500 ? 'high' : 'medium',
        discount: origPriceVal ? Math.round((1 - priceVal / origPriceVal) * 100) : 0,
      };
    });
  } catch(e) {
    console.warn('Walmart Live API error:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════

// Route: Fetch trending products
app.get('/api/fetch-products', async (req, res) => {
  const keyword = req.query.keyword || '';
  const market = req.query.market || 'both'; // US, GB, both
  const category = req.query.category || 'electronics';
  const limit = parseInt(req.query.limit) || 12;

  const searchQuery = keyword.trim() || category;
  const apiKey = process.env.RAPIDAPI_KEY;

  const itemsPerSource = Math.ceil(limit / 3);
  let products = [];
  let mode = 'live';

  try {
    const markets = market === 'both' ? ['US', 'GB'] : [market];

    if (!apiKey) {
      mode = 'demo';
      // No API key provided -> Run public scraper + mock fallbacks
      console.log(`[API] Demo mode active for query: "${searchQuery}"`);

      // 1. eBay public scraper (gives actual live data!)
      for (const m of markets) {
        const ebayData = await scrapeEbayPublic(searchQuery, m, itemsPerSource);
        products = products.concat(ebayData);
      }

      // 2. Amazon mock data generator
      for (const m of markets) {
        const amzMock = generateMockProducts(searchQuery, 'amazon', m, itemsPerSource);
        products = products.concat(amzMock);
      }

      // 3. Walmart mock data generator (US only)
      if (market !== 'GB') {
        const wmtMock = generateMockProducts(searchQuery, 'walmart', 'US', itemsPerSource);
        products = products.concat(wmtMock);
      }
    } else {
      // Live API Mode
      console.log(`[API] Live mode active using RapidAPI key for query: "${searchQuery}"`);

      // 1. Amazon API
      for (const m of markets) {
        const amz = await fetchAmazonLive(searchQuery, m, apiKey, itemsPerSource);
        products = products.concat(amz);
      }

      // 2. eBay API
      for (const m of markets) {
        const ebay = await fetchEbayLive(searchQuery, m, apiKey, itemsPerSource);
        products = products.concat(ebay);
      }

      // 3. Walmart API (US Only)
      if (market !== 'GB') {
        const wmt = await fetchWalmartLive(searchQuery, apiKey, itemsPerSource);
        products = products.concat(wmt);
      }

      // ── LIVE FALLBACK FOR 403/429 ERRORS OR EMPTY RESULTS ──
      if (products.length === 0) {
        console.log(`[API] Live endpoints returned 0 items. Running fallback scrapers.`);
        mode = 'live-fallback';

        // 1. eBay public scraper
        for (const m of markets) {
          const ebayData = await scrapeEbayPublic(searchQuery, m, itemsPerSource);
          products = products.concat(ebayData);
        }

        // 2. Amazon mock data generator
        for (const m of markets) {
          const amzMock = generateMockProducts(searchQuery, 'amazon', m, itemsPerSource);
          products = products.concat(amzMock);
        }

        // 3. Walmart mock data generator (US only)
        if (market !== 'GB') {
          const wmtMock = generateMockProducts(searchQuery, 'walmart', 'US', itemsPerSource);
          products = products.concat(wmtMock);
        }
      }
    }

    // Attach basic generated SEO to all products
    const enrichedProducts = products.map(p => {
      const seo = generateSEO(p);
      return {
        ...p,
        seoTitle: seo.seoTitle,
        metaDesc: seo.metaDesc,
        h1: seo.h1,
        keywords: seo.keywords,
        schema: seo.schema
      };
    });

    res.json({
      success: true,
      mode: mode,
      products: enrichedProducts
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to extract products',
      error: error.message
    });
  }
});

// Route: Get saved products
app.get('/api/saved-products', (req, res) => {
  const db = readDB();
  res.json({ success: true, products: db });
});

// Route: Save product
app.post('/api/saved-products', (req, res) => {
  const newProduct = req.body;
  
  if (!newProduct.id || !newProduct.title) {
    return res.status(400).json({ success: false, message: 'Invalid product data' });
  }

  const db = readDB();
  
  // Check if product is already saved
  const idx = db.findIndex(p => p.id === newProduct.id);
  if (idx !== -1) {
    // Update existing saved item
    db[idx] = {
      ...db[idx],
      ...newProduct,
      savedAt: db[idx].savedAt || new Date().toISOString()
    };
  } else {
    // Add new item
    db.push({
      ...newProduct,
      savedAt: new Date().toISOString()
    });
  }

  writeDB(db);
  res.json({ success: true, product: newProduct });
});

// Route: Update saved product
app.put('/api/saved-products/:id', (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  const db = readDB();
  const idx = db.findIndex(p => p.id === id);

  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Product not found in saved list' });
  }

  db[idx] = {
    ...db[idx],
    ...updatedData,
    updatedAt: new Date().toISOString()
  };

  writeDB(db);
  res.json({ success: true, product: db[idx] });
});

// Route: Delete saved product
app.delete('/api/saved-products/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const filtered = db.filter(p => p.id !== id);

  if (filtered.length === db.length) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  writeDB(filtered);
  res.json({ success: true, message: 'Product removed from saved list' });
});

// Helper for CSV escaping
function escapeCSVValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // Replace double quotes with two double quotes
  str = str.replace(/"/g, '""');
  // Enclose in double quotes if it contains comma, double quotes or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = `"${str}"`;
  }
  return str;
}

// Route: Export Saved Products in CSV format (Shopify or WooCommerce)
app.get('/api/export', (req, res) => {
  const format = req.query.format || 'shopify'; // shopify, woocommerce, standard
  const db = readDB();

  if (db.length === 0) {
    return res.status(400).send('No saved products to export. Save some products first.');
  }

  let csvContent = '';
  let filename = `export-${format}-${new Date().toISOString().slice(0, 10)}.csv`;

  if (format === 'shopify') {
    // Shopify CSV Headers
    const headers = [
      'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Standard Product Type', 
      'Custom Product Type', 'Tags', 'Published', 'Option1 Name', 'Option1 Value', 
      'Variant SKU', 'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 
      'Variant Taxable', 'Image Src', 'Image Alt Text', 'SEO Title', 'SEO Description', 'Status'
    ];

    csvContent += headers.join(',') + '\r\n';

    db.forEach(p => {
      const handle = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const title = p.customTitle || p.seoTitle || p.title;
      
      const body = p.customMetaDesc || p.metaDesc || `Buy ${p.title} at great prices.`;
      const vendor = `Imported from ${p.source.toUpperCase()}`;
      const type = p.category || 'General';
      const tags = (p.customKeywords || p.keywords || []).slice(0, 8).join(', ');
      
      const price = p.customPrice || p.price;
      const comparePrice = p.originalPrice && p.originalPrice > price ? p.originalPrice : '';
      const image = p.image || '';
      
      const seoTitle = p.customTitle || p.seoTitle || title;
      const seoDesc = p.customMetaDesc || p.metaDesc || body;

      const row = [
        handle, title, body, vendor, type, 
        '', tags, 'TRUE', 'Title', 'Default Title',
        p.id, price, comparePrice, 'TRUE', 
        'TRUE', image, title, seoTitle, seoDesc.substring(0, 160), 'active'
      ];

      csvContent += row.map(escapeCSVValue).join(',') + '\r\n';
    });

  } else if (format === 'woocommerce') {
    // WooCommerce CSV Headers
    const headers = [
      'Type', 'SKU', 'Name', 'Published', 'Short description', 'Description', 
      'In stock?', 'Regular price', 'Sale price', 'Categories', 'Tags', 
      'Images', 'External URL', 'Button text'
    ];

    csvContent += headers.join(',') + '\r\n';

    db.forEach(p => {
      const name = p.customTitle || p.seoTitle || p.title;
      const shortDesc = p.customMetaDesc || p.metaDesc || '';
      const desc = `<h2>${p.customH1 || p.h1 || name}</h2><p>${shortDesc}</p><p>Imported original item. Rated ${p.rating}/5 stars on original platform.</p>`;
      const price = p.customPrice || p.price;
      const salePrice = ''; // Default regular price
      const categories = p.category || 'E-Commerce Imports';
      const tags = (p.customKeywords || p.keywords || []).slice(0, 8).join(', ');
      const buttonText = `Buy on ${p.source.charAt(0).toUpperCase() + p.source.slice(1)}`;

      const row = [
        'external', p.id, name, '1', shortDesc, desc,
        '1', price, salePrice, categories, tags,
        p.image || '', p.url, buttonText
      ];

      csvContent += row.map(escapeCSVValue).join(',') + '\r\n';
    });

  } else {
    // Standard General CSV Format
    const headers = [
      'ID', 'Source', 'Market', 'Title', 'Price', 'Original Price', 'Currency', 
      'Rating', 'Reviews', 'Category', 'SEO Title', 'Meta Description', 'Keywords', 'URL', 'Image'
    ];

    csvContent += headers.join(',') + '\r\n';

    db.forEach(p => {
      const row = [
        p.id, p.source, p.market, p.title, p.price, p.originalPrice || '', p.currency,
        p.rating, p.reviews, p.category, p.customTitle || p.seoTitle || '', 
        p.customMetaDesc || p.metaDesc || '', (p.customKeywords || p.keywords || []).join('; '), p.url, p.image
      ];

      csvContent += row.map(escapeCSVValue).join(',') + '\r\n';
    });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.status(200).send(csvContent);
});

// ═══════════════════════════════════════════════════════════
//  GOOGLE DRIVE BACKUP SERVICES
// ═══════════════════════════════════════════════════════════
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');

function getDriveClient() {
  const folderId = process.env.GD_FOLDER_ID;
  if (!folderId) {
    throw new Error('GD_FOLDER_ID is not configured in your .env file.');
  }

  let auth;
  const envCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (envCreds) {
    try {
      const credentials = JSON.parse(envCreds);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
      });
    } catch (e) {
      throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ' + e.message);
    }
  } else if (fs.existsSync(CREDENTIALS_FILE)) {
    auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_FILE,
      scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });
  } else {
    throw new Error('Google Drive configuration missing: credentials.json not found, and GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  return google.drive({ version: 'v3', auth });
}

async function uploadDatabaseToDrive() {
  const drive = getDriveClient();
  const folderId = process.env.GD_FOLDER_ID;
  const fileName = 'marketpulse-saved-products.json';

  const response = await drive.files.list({
    q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const files = response.data.files;
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType: 'application/json',
    body: fs.createReadStream(DB_FILE),
  };

  if (files && files.length > 0) {
    const fileId = files[0].id;
    console.log(`[Drive] Updating existing backup: ${fileId}`);
    const updateRes = await drive.files.update({
      fileId: fileId,
      media: media,
      fields: 'id, name, modifiedTime',
    });
    return { status: 'updated', fileId: updateRes.data.id, modifiedTime: updateRes.data.modifiedTime };
  } else {
    console.log(`[Drive] Creating new backup file.`);
    const createRes = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name',
    });
    return { status: 'created', fileId: createRes.data.id };
  }
}

// Route: Get Google Drive Backup configuration status
app.get('/api/backup/status', (req, res) => {
  const credsExist = fs.existsSync(CREDENTIALS_FILE);
  const envCredsExist = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GD_FOLDER_ID || '';
  
  let clientEmail = '';
  if (envCredsExist) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      clientEmail = creds.client_email || '';
    } catch (e) {
      console.warn('[Drive] Env credentials parse error:', e.message);
    }
  } else if (credsExist) {
    try {
      const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
      clientEmail = creds.client_email || '';
    } catch (e) {
      console.warn('[Drive] File credentials parse error:', e.message);
    }
  }

  res.json({
    success: true,
    configured: (credsExist || envCredsExist) && folderId.trim().length > 0,
    hasCredentials: credsExist || envCredsExist,
    hasFolderId: folderId.trim().length > 0,
    clientEmail: clientEmail,
    folderId: folderId
  });
});

// Route: Trigger manual backup to Google Drive
app.post('/api/backup/trigger', async (req, res) => {
  try {
    const db = readDB();
    if (db.length === 0) {
      return res.status(400).json({ success: false, message: 'Your database is empty! Save some products first before backing up.' });
    }
    const result = await uploadDatabaseToDrive();
    res.json({
      success: true,
      message: `Backup successfully ${result.status === 'updated' ? 'updated' : 'created'} in Google Drive!`,
      details: result
    });
  } catch (e) {
    console.error('[Drive Backup Error]:', e.message);
    res.status(500).json({
      success: false,
      message: 'Google Drive backup failed',
      error: e.message
    });
  }
});

// Fallback to serve index.html for undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 MarketPulse E-Commerce Server Running!`);
  console.log(`💻 Local URL: http://localhost:${PORT}`);
  console.log(`⚙️  API Key: ${process.env.RAPIDAPI_KEY ? 'CONFIGURED' : 'NONE (Using Demo & Fallback Scrapers)'}`);
  console.log(`📦 Database: ${DB_FILE}`);
  console.log(`=================================================`);
});
