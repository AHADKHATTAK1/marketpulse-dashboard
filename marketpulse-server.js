const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, 'product-dashboard.html');
const SOURCES = ['amazon', 'ebay', 'walmart'];
const CACHE_TTL_MS = 10 * 60 * 1000;

const DEMO_PRODUCTS = [
  {
    id: 'demo-1',
    source: 'amazon',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
    price: 278,
    originalPrice: 349.99,
    currency: '$',
    rating: 4.8,
    reviews: 42390,
    image: 'https://m.media-amazon.com/images/I/61vJnmmTpCL._AC_SL1500_.jpg',
    category: 'Electronics',
    market: 'US',
    url: 'https://amazon.com',
    demand: 'high',
    discount: 20,
  },
  {
    id: 'demo-2',
    source: 'ebay',
    title: 'Apple AirPods Pro (2nd Generation) Wireless Earbuds',
    price: 189.99,
    originalPrice: 249,
    currency: '$',
    rating: 4.6,
    reviews: 8920,
    image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MME73?wid=572&hei=572&fmt=jpeg',
    category: 'Electronics',
    market: 'US',
    url: 'https://ebay.com',
    demand: 'high',
    discount: 24,
  },
  {
    id: 'demo-3',
    source: 'walmart',
    title: 'Ninja AF101 Air Fryer that Cooks, Crisps and Dehydrates',
    price: 99.99,
    originalPrice: 129,
    currency: '$',
    rating: 4.7,
    reviews: 22104,
    image: 'https://i5.walmartimages.com/asr/5f55e8b0-8d27-45ef-a3e8-6fbc1e6d5ab5.jpeg',
    category: 'Home & Kitchen',
    market: 'US',
    url: 'https://walmart.com',
    demand: 'high',
    discount: 22,
  },
];

const cache = new Map();
let lastRefreshAt = null;
let refreshInProgress = false;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function normalizeText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePrice(value) {
  const parsed = Number.parseFloat(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyForMarket(market) {
  return market === 'GB' ? '£' : '$';
}

function inferDemand(reviews, rating) {
  if (reviews >= 10000 || rating >= 4.7) return 'high';
  if (reviews >= 1000 || rating >= 4.3) return 'medium';
  return 'low';
}

function seoForProduct(product) {
  const cleanTitle = normalizeText(product.title).replace(/[^\w\s,\-]/g, '');
  const year = new Date().getFullYear();
  const keywordBase = cleanTitle.split(' ').slice(0, 4).join(' ') || 'Product';
  const marketLabel = product.market === 'GB' ? 'UK' : 'US';

  return {
    seoTitle: `${cleanTitle.slice(0, 55)} | Best Price ${product.currency}${product.price} [${year}]`,
    metaDesc: `Buy ${cleanTitle.slice(0, 60)} at ${product.currency}${product.price}. ${product.rating}/5 stars from ${product.reviews.toLocaleString()} reviews. ${marketLabel} market product.`,
    h1: `${cleanTitle} — ${product.currency}${product.price} ${product.demand === 'high' ? '🔥 Trending' : ''}`,
    keywords: [
      keywordBase,
      `buy ${keywordBase.toLowerCase()}`,
      `best ${String(product.category || 'products').toLowerCase()} ${year}`,
      `${keywordBase} deals`,
      `${keywordBase} ${marketLabel}`,
    ],
    schema: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: cleanTitle,
      image: product.image,
      description: `Buy ${cleanTitle} for ${product.currency}${product.price}.`,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: product.currency === '$' ? 'USD' : 'GBP',
        availability: 'https://schema.org/InStock',
        url: product.url,
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.rating,
        reviewCount: product.reviews,
      },
    }, null, 2),
  };
}

function makeProduct(source, item, defaults) {
  const title = normalizeText(item.title || item.name || item.product_title || defaults.query || 'Trending product');
  const price = normalizePrice(item.price?.value || item.price?.current || item.salePrice || item.price || item.currentPrice || item.listPrice || 0);
  const originalPrice = normalizePrice(item.originalPrice || item.price?.was || item.msrp || item.regularPrice || 0);
  const rating = Number.parseFloat(item.rating?.averageRating || item.rating || item.product_star_rating || item.productRating || 0) || 0;
  const reviews = Number.parseInt(String(item.reviews || item.rating?.numberOfReviews || item.product_num_ratings || item.reviewCount || 0).replace(/,/g, ''), 10) || 0;
  const market = item.market || defaults.market;
  const currency = item.currency || currencyForMarket(market);
  const discount = originalPrice > price && price > 0 ? Math.max(0, Math.round((1 - price / originalPrice) * 100)) : 0;

  const product = {
    id: item.id || item.asin || item.itemId || `${source}-${Buffer.from(title).toString('hex').slice(0, 12)}`,
    source,
    title,
    price,
    originalPrice,
    currency,
    rating,
    reviews,
    image: item.image || item.imageUrl || item.product_photo || item.thumbnail || '',
    category: normalizeText(item.category || defaults.category || 'General'),
    market,
    url: item.url || item.product_url || item.productPageUrl || item.link || defaults.url,
    demand: item.demand || inferDemand(reviews, rating),
    discount,
    collectedAt: new Date().toISOString(),
  };

  return { ...product, seo: seoForProduct(product) };
}

function sourceStatus() {
  return SOURCES.map((source) => ({
    name: source,
    state: process.env[`${source.toUpperCase()}_API_URL`] ? 'online' : 'pending',
    details: process.env[`${source.toUpperCase()}_API_URL`] ? 'configured' : 'demo fallback',
  }));
}

async function fetchRemoteSource(source, defaults) {
  const baseUrl = process.env[`${source.toUpperCase()}_API_URL`];
  const token = process.env[`${source.toUpperCase()}_API_TOKEN`];

  if (!baseUrl) {
    return [];
  }

  const url = new URL(baseUrl);
  url.searchParams.set('query', defaults.query);
  url.searchParams.set('market', defaults.market);
  url.searchParams.set('category', defaults.category);
  url.searchParams.set('limit', '12');

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${source} api returned ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload.products)
    ? payload.products
    : Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.items)
        ? payload.items
        : [];

  return items.map((item) => makeProduct(source, item, defaults));
}

async function collectProducts(params) {
  const defaults = {
    query: params.query || 'trending products',
    market: params.market === 'GB' ? 'GB' : 'US',
    category: params.category || 'bestsellers',
    url: 'https://example.com',
  };

  const batches = await Promise.all(SOURCES.map(async (source) => {
    try {
      const remote = await fetchRemoteSource(source, defaults);
      if (remote.length) {
        return remote;
      }
    } catch (error) {
      console.warn(`[${source}] remote fetch failed:`, error.message);
    }

    return DEMO_PRODUCTS.filter((product) => product.source === source).map((product) => ({
      ...product,
      seo: seoForProduct(product),
      collectedAt: new Date().toISOString(),
    }));
  }));

  const merged = batches.flat();
  const query = String(defaults.query || '').toLowerCase();
  const filtered = merged.filter((product) => {
    const matchesQuery = !query || product.title.toLowerCase().includes(query) || String(product.category || '').toLowerCase().includes(query);
    const matchesMarket = params.market === 'both' || product.market === defaults.market;
    const matchesCategory = !params.category || params.category === 'bestsellers' || String(product.category || '').toLowerCase().includes(String(params.category).toLowerCase());
    return matchesQuery && matchesMarket && matchesCategory;
  });

  return {
    products: filtered.slice(0, params.limit || 36),
    sources: sourceStatus(),
    generatedAt: new Date().toISOString(),
  };
}

function cacheKey(params) {
  return [params.query || '', params.market || 'US', params.category || 'bestsellers', params.limit || 36].join('|');
}

async function getProducts(params) {
  const key = cacheKey(params);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const payload = await collectProducts(params);
  cache.set(key, { savedAt: Date.now(), payload });
  lastRefreshAt = payload.generatedAt;
  return payload;
}

async function backgroundWarmup() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    await Promise.all([
      getProducts({ query: 'trending gadgets', market: 'US', category: 'electronics', limit: 24 }),
      getProducts({ query: 'air fryer', market: 'US', category: 'home', limit: 24 }),
      getProducts({ query: 'wireless earbuds', market: 'GB', category: 'electronics', limit: 24 }),
    ]);
    lastRefreshAt = new Date().toISOString();
    console.log(`Background refresh complete at ${lastRefreshAt}`);
  } catch (error) {
    console.error('Background refresh failed:', error.message);
  } finally {
    refreshInProgress = false;
  }
}

function statusPayload() {
  return {
    ok: true,
    lastRefreshAt,
    cacheEntries: cache.size,
    sources: sourceStatus(),
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/') {
    sendHtml(res);
    return;
  }

  if (requestUrl.pathname === '/api/health' || requestUrl.pathname === '/api/status') {
    sendJson(res, 200, statusPayload());
    return;
  }

  if (requestUrl.pathname === '/api/products') {
    try {
      const payload = await getProducts({
        query: requestUrl.searchParams.get('query') || '',
        market: requestUrl.searchParams.get('market') || 'US',
        category: requestUrl.searchParams.get('category') || 'bestsellers',
        limit: Number.parseInt(requestUrl.searchParams.get('limit') || '36', 10) || 36,
      });
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  const filePath = path.join(ROOT, requestUrl.pathname);
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`MarketPulse backend running at http://localhost:${PORT}`);
  backgroundWarmup();
  setInterval(backgroundWarmup, CACHE_TTL_MS);
});
