// ═══════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════
let activeTab = 'explorer';
let scrapedProducts = [];
let savedProducts = [];
let currentEditingProduct = null;
let activeSourceFilter = null;

// ── AUTO-UPDATE STATE ──
let autoUpdateActive = false;
let autoUpdatePaused = false;
let autoIntervalSec = 120;       // default 2 min
let autoCountdownSec = 120;
let autoCountdownTimer = null;   // setInterval for countdown tick
let autoCycleEnabled = false;
let autoRefreshCount = 0;
let autoTotalFetched = 0;
let autoCycleIndex = 0;
const AUTO_CATEGORIES = ['bestsellers','electronics','home','fashion','beauty','sports','toys'];

// ═══════════════════════════════════════════════════════════
//  APP INITIALIZATION
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  updateSavedCountBadge();
  checkBackupStatus();
  initAutoUpdateUI();

  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchProducts();
  });
});


// ═══════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  activeTab = tab;
  
  // Toggle tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Toggle panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  if (tab === 'explorer') {
    document.querySelector('.tab-btn[onclick="switchTab(\'explorer\')"]').classList.add('active');
    document.getElementById('panel-explorer').classList.add('active');
  } else {
    document.querySelector('.tab-btn[onclick="switchTab(\'imports\')"]').classList.add('active');
    document.getElementById('panel-imports').classList.add('active');
    fetchSavedProducts(); // Refresh saved products list
    checkBackupStatus();  // Check backup status
  }
}

// ═══════════════════════════════════════════════════════════
//  FETCH PRODUCTS (EXPLORER)
// ═══════════════════════════════════════════════════════════
async function fetchProducts() {
  const keyword = document.getElementById('search-input').value.trim();
  const market = document.getElementById('market-select').value;
  const category = document.getElementById('category-select').value;

  // Reset active source filters when a new search is initiated
  activeSourceFilter = null;
  document.querySelectorAll('.filter-badge').forEach(btn => {
    btn.classList.remove('active');
  });

  // Toggle UI Loading states
  document.getElementById('loading').style.display = 'block';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('products-section').style.display = 'none';
  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('mode-banner').style.display = 'none';
  document.getElementById('error-banner').style.display = 'none';
  document.getElementById('fetch-btn').disabled = true;

  try {
    const url = `/api/fetch-products?keyword=${encodeURIComponent(keyword)}&market=${market}&category=${category}&limit=24`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'Error occurred while scraping');
    }

    scrapedProducts = data.products || [];

    // Show mode banner based on which API tier was used
    const sourceStr = (data.sources || []).map(s => `<strong>${s.charAt(0).toUpperCase() + s.slice(1)}</strong>`).join(', ');
    
    if (data.mode === 'live-rapidapi') {
      showBanner('mode-banner', 'mode-text', `🚀 <strong>Live RapidAPI Mode:</strong> Fetched ${data.total} real-time products from ${sourceStr}. Data is live and updated.`);
    } else if (data.mode === 'auto-free-api') {
      showBanner('mode-banner', 'mode-text', `✅ <strong>Auto-API Mode:</strong> Loaded ${data.total} products from free public APIs (${sourceStr}). No key required — always works! Add a RapidAPI key to <code>.env</code> for live Amazon/Walmart data.`);
    } else if (data.mode === 'scraped') {
      showBanner('mode-banner', 'mode-text', `🔍 <strong>Live Scraper Mode:</strong> Fetched ${data.total} real products from eBay live search + curated database.`);
    } else if (data.mode === 'partial') {
      showBanner('mode-banner', 'mode-text', `⚡ <strong>Hybrid Mode:</strong> ${data.total} products from live APIs + curated database (${sourceStr}). Configure your RapidAPI key for full live data.`);
    } else {
      showBanner('mode-banner', 'mode-text', `📦 <strong>Curated Mode:</strong> Showing ${data.total} curated trending products from ${sourceStr}. All products include real prices and images.`);
    }

    // Sort and render products
    applyFilters();
    calculateStats(scrapedProducts);

  } catch (error) {
    console.error('Fetch error:', error);
    showBanner('error-banner', 'error-text', `Failed to scrape products: ${error.message}. Please verify the backend connection.`);
    document.getElementById('empty-state').style.display = 'block';
  } finally {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('fetch-btn').disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  APPLY FILTERING AND SORTING
// ═══════════════════════════════════════════════════════════
function applyFilters(prevIds = null) {
  const sortBy = document.getElementById('sort-select').value;
  let products = [...scrapedProducts];

  // Apply source brand filter if active
  if (activeSourceFilter) {
    products = products.filter(p => p.source === activeSourceFilter);
  }

  // Sort logic
  const demandScore = { high: 3, medium: 2, low: 1 };
  products.sort((a, b) => {
    switch (sortBy) {
      case 'demand':
        return (demandScore[b.demand] || 0) - (demandScore[a.demand] || 0) || b.reviews - a.reviews;
      case 'price_low':
        return a.price - b.price;
      case 'price_high':
        return b.price - a.price;
      case 'rating':
        return b.rating - a.rating;
      case 'reviews':
        return b.reviews - a.reviews;
      default:
        return 0;
    }
  });

  renderProductsGrid(products, 'products-grid', false, prevIds);
  
  if (scrapedProducts.length > 0) {
    document.getElementById('products-section').style.display = 'block';
    document.getElementById('results-header').style.display = 'flex';
    
    if (activeSourceFilter) {
      const srcName = activeSourceFilter.charAt(0).toUpperCase() + activeSourceFilter.slice(1);
      document.getElementById('result-count').textContent = `Showing ${products.length} ${srcName} products (filtered from ${scrapedProducts.length} total)`;
    } else {
      document.getElementById('result-count').textContent = `${products.length} products found`;
    }
  } else {
    document.getElementById('products-section').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  RENDER PRODUCTS GRID
// ═══════════════════════════════════════════════════════════
function renderProductsGrid(products, gridId, isSavedGrid, prevIds = null) {
  const grid = document.getElementById(gridId);
  grid.innerHTML = '';

  if (products.length === 0) {
    if (isSavedGrid) {
      document.getElementById('imports-empty-state').style.display = 'block';
      document.getElementById('export-card').style.display = 'none';
    }
    return;
  }

  if (isSavedGrid) {
    document.getElementById('imports-empty-state').style.display = 'none';
    document.getElementById('export-card').style.display = 'flex';
    document.getElementById('export-count').textContent = products.length;
  }

  products.forEach((p, idx) => {
    const isSaved = isSavedGrid || savedProducts.some(item => item.id === p.id);
    const starString = '★'.repeat(Math.floor(p.rating)) + '☆'.repeat(5 - Math.floor(p.rating));
    
    // Check if product has custom edited SEO title, otherwise fallback
    const displayTitle = p.customTitle || p.seoTitle || p.title;
    const displayPrice = p.customPrice || p.price;
    const currency = p.currency || '$';

    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => openEditorModal(p.id, isSavedGrid);

    card.innerHTML = `
      <span class="card-source-tag src-tag-${p.source}">${p.source}</span>
      <span class="card-rank-badge">#${idx + 1}</span>
      <div class="card-img-wrapper">
        <img src="${p.image}" alt="${displayTitle}" loading="lazy" onerror="this.src='https://placehold.co/200x200?text=No+Image'">
      </div>
      <div class="card-details">
        <div class="card-market-cat">${p.market === 'GB' ? '🇬🇧 UK' : '🇺🇸 US'} · ${p.category}</div>
        <h3 class="card-prod-title">${displayTitle}</h3>
        
        <div class="card-price-block">
          <span class="current-price">${currency}${parseFloat(displayPrice).toFixed(2)}</span>
          ${p.originalPrice > displayPrice ? `<span class="original-price">${currency}${parseFloat(p.originalPrice).toFixed(2)}</span>` : ''}
          ${p.discount > 0 ? `<span class="discount-percentage">-${p.discount}%</span>` : ''}
        </div>

        <div class="card-stats-row">
          <span class="rating-stars">${starString} ${p.rating}</span>
          <span class="reviews-count">(${p.reviews.toLocaleString()})</span>
          <span class="demand-indicator ${p.demand}">${p.demand === 'high' ? '🔥 Hot' : p.demand === 'medium' ? '📈 Rising' : '📦 Normal'}</span>
        </div>

        <div class="card-seo-tags">
          <div class="seo-tags-title">🔑 SEO Tags</div>
          <div class="seo-tags-list">
            ${(p.customKeywords || p.keywords || []).slice(0, 3).map(kw => `<span class="seo-tag">${kw}</span>`).join('')}
          </div>
        </div>

        <div class="card-actions-row">
          <button class="btn-card-action">Optimize SEO</button>
          <button class="btn-card-action btn-save-to-import ${isSaved ? 'saved' : ''}" 
                  onclick="event.stopPropagation(); toggleQuickSave('${p.id}', this)">
            ${isSaved ? '✅ Saved' : '📥 Save'}
          </button>
        </div>
      </div>
    `;
    // Flash new cards during auto-update
    if (prevIds && !prevIds.has(p.id)) {
      card.classList.add('is-new');
    }
    grid.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
//  STATS CALCULATOR
// ═══════════════════════════════════════════════════════════
function calculateStats(products) {
  if (products.length === 0) return;

  const total = products.length;
  const avg = products.reduce((acc, p) => acc + p.price, 0) / total;
  const hot = products.filter(p => p.demand === 'high').length;
  const sources = new Set(products.map(p => p.source)).size;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-avg-price').textContent = `$${avg.toFixed(0)}`;
  document.getElementById('stat-high-demand').textContent = hot;
  document.getElementById('stat-sources').textContent = sources;

  document.getElementById('stats-bar').style.display = 'grid';
}

// ═══════════════════════════════════════════════════════════
//  SAVED PRODUCTS MANAGEMENT (IMPORTS)
// ═══════════════════════════════════════════════════════════
async function fetchSavedProducts() {
  try {
    const res = await fetch('/api/saved-products');
    const data = await res.json();
    if (data.success) {
      savedProducts = data.products || [];
      renderProductsGrid(savedProducts, 'imports-grid', true);
      updateSavedCountBadge();
    }
  } catch (error) {
    console.error('Error fetching saved products:', error);
  }
}

async function updateSavedCountBadge() {
  try {
    const res = await fetch('/api/saved-products');
    const data = await res.json();
    if (data.success) {
      const count = data.products?.length || 0;
      document.getElementById('saved-count-badge').textContent = count;
    }
  } catch (e) {
    // Fail silently in background
  }
}

// Quick Save direct from explorer card
async function toggleQuickSave(productId, btnElement) {
  // Find in already saved list first
  const alreadySavedIndex = savedProducts.findIndex(p => p.id === productId);

  if (alreadySavedIndex !== -1) {
    // Delete item
    try {
      const res = await fetch(`/api/saved-products/${productId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Removed from Import List!', 'error');
        btnElement.classList.remove('saved');
        btnElement.innerHTML = '📥 Save';
        savedProducts = savedProducts.filter(p => p.id !== productId);
        updateSavedCountBadge();
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    // Save item
    const product = scrapedProducts.find(p => p.id === productId);
    if (!product) return;

    try {
      const res = await fetch('/api/saved-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Saved to Import List!');
        btnElement.classList.add('saved');
        btnElement.innerHTML = '✅ Saved';
        fetchSavedProducts(); // update global saved array
      }
    } catch (e) {
      console.error(e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  SEO EDITOR MODAL
// ═══════════════════════════════════════════════════════════
function openEditorModal(productId, isFromSavedList) {
  // Retrieve item
  const product = isFromSavedList 
    ? savedProducts.find(p => p.id === productId)
    : scrapedProducts.find(p => p.id === productId) || savedProducts.find(p => p.id === productId);

  if (!product) return;
  currentEditingProduct = product;

  // Render modal static elements
  document.getElementById('modal-source-badge').textContent = product.source;
  document.getElementById('modal-source-badge').className = `badge badge-${product.source}`;
  document.getElementById('modal-market-badge').textContent = product.market === 'GB' ? '🇬🇧 UK Market' : '🇺🇸 US Market';
  
  document.getElementById('modal-image').src = product.image;
  document.getElementById('modal-original-title').textContent = product.title;
  
  const curr = product.currency || '$';
  document.getElementById('modal-original-price').textContent = `${curr}${product.price.toFixed(2)}`;
  document.getElementById('modal-reviews').textContent = product.reviews.toLocaleString();
  document.getElementById('modal-rating').textContent = `⭐ ${product.rating}`;
  document.getElementById('modal-original-link').href = product.url;

  // Setup Form inputs
  document.getElementById('seo-input-title').value = product.customTitle || product.seoTitle || product.title;
  document.getElementById('seo-input-h1').value = product.customH1 || product.h1 || product.title;
  document.getElementById('seo-input-desc').value = product.customMetaDesc || product.metaDesc || '';
  
  const kws = product.customKeywords || product.keywords || [];
  document.getElementById('seo-input-keywords').value = kws.join(', ');

  // Schema Markup rendering
  document.getElementById('seo-schema-preview').textContent = product.schema || '';

  // Pricing calculator inputs
  document.getElementById('calc-cost').value = product.price.toFixed(2);
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = curr);

  const markupPrice = product.customPrice || (product.price * 1.3); // 30% default markup
  document.getElementById('calc-selling').value = parseFloat(markupPrice).toFixed(2);

  // Character counters initialization
  updateCharCount('seo-input-title', 'title-char-count', 70);
  updateCharCount('seo-input-desc', 'desc-char-count', 160);

  // Trigger initial calculation
  calculateMargin();

  // Show/Hide delete button
  const deleteBtn = document.getElementById('btn-delete-saved');
  if (isFromSavedList || savedProducts.some(p => p.id === product.id)) {
    deleteBtn.style.display = 'block';
  } else {
    deleteBtn.style.display = 'none';
  }

  // Open Modal
  document.getElementById('editor-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('editor-modal').classList.remove('open');
  currentEditingProduct = null;
}

function handleModalOverlayClick(e) {
  if (e.target.id === 'editor-modal') {
    closeModal();
  }
}

// ═══════════════════════════════════════════════════════════
//  MARKUP CALCULATOR
// ═══════════════════════════════════════════════════════════
function calculateMargin() {
  const cost = parseFloat(document.getElementById('calc-cost').value) || 0;
  const selling = parseFloat(document.getElementById('calc-selling').value) || 0;
  const curr = currentEditingProduct ? currentEditingProduct.currency : '$';

  const profit = selling - cost;
  let marginPercent = 0;
  
  if (selling > 0) {
    marginPercent = (profit / selling) * 100;
  }

  document.getElementById('calc-profit').textContent = `${curr}${profit.toFixed(2)}`;
  document.getElementById('calc-margin').textContent = `${marginPercent.toFixed(0)}%`;
  
  // Visual validation triggers
  const profitBox = document.getElementById('calc-profit');
  if (profit < 0) {
    profitBox.style.color = '#ef4444'; // Red for negative profit
  } else {
    profitBox.style.color = 'var(--accent-secondary)'; // Cyan for positive profit
  }
}

// ═══════════════════════════════════════════════════════════
//  CHAR COUNTERS & UI UTILITIES
// ═══════════════════════════════════════════════════════════
function updateCharCount(inputId, counterId, limit) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  const length = input.value.length;
  
  counter.textContent = length;
  
  if (length > limit) {
    counter.style.color = '#ef4444';
  } else if (length > limit - 10) {
    counter.style.color = 'var(--accent-orange)';
  } else {
    counter.style.color = 'var(--text-dim)';
  }
}

function showBanner(bannerId, textId, htmlContent) {
  const banner = document.getElementById(bannerId);
  const text = document.getElementById(textId);
  text.innerHTML = htmlContent;
  banner.style.display = 'flex';
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  
  if (type === 'info') {
    toast.style.background = '#6366f1';
    toast.style.boxShadow = '0 10px 25px rgba(99, 102, 241, 0.3)';
  } else if (type === 'error') {
    toast.style.background = '#ef4444';
    toast.style.boxShadow = '0 10px 25px rgba(239, 68, 68, 0.3)';
  } else {
    toast.style.background = '#10b981';
    toast.style.boxShadow = '0 10px 25px rgba(16, 185, 129, 0.3)';
  }
  
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// ═══════════════════════════════════════════════════════════
//  SAVE SEO DETAILS TO DATABASE (FORM SUBMIT)
// ═══════════════════════════════════════════════════════════
async function saveProductSEO(e) {
  e.preventDefault();
  if (!currentEditingProduct) return;

  const customTitle = document.getElementById('seo-input-title').value.trim();
  const customH1 = document.getElementById('seo-input-h1').value.trim();
  const customMetaDesc = document.getElementById('seo-input-desc').value.trim();
  const rawKeywords = document.getElementById('seo-input-keywords').value;
  const customKeywords = rawKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const customPrice = parseFloat(document.getElementById('calc-selling').value) || currentEditingProduct.price;

  // Build payload
  const updatedProduct = {
    ...currentEditingProduct,
    customTitle,
    customH1,
    customMetaDesc,
    customKeywords,
    customPrice
  };

  try {
    const res = await fetch('/api/saved-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedProduct)
    });
    const data = await res.json();

    if (data.success) {
      showToast('SEO settings saved successfully!');
      closeModal();
      
      // Reload relevant content
      if (activeTab === 'imports') {
        fetchSavedProducts();
      } else {
        // Just refresh the lists in explorer view
        fetchSavedProducts().then(applyFilters);
      }
    } else {
      showToast('Failed to save SEO settings', 'error');
    }
  } catch (error) {
    console.error('Error saving SEO product:', error);
    showToast('Failed to save settings to server', 'error');
  }
}

// Delete item from saved list
async function deleteSavedProduct() {
  if (!currentEditingProduct) return;
  const confirmDelete = confirm('Are you sure you want to remove this product from your import list?');
  if (!confirmDelete) return;

  try {
    const res = await fetch(`/api/saved-products/${currentEditingProduct.id}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      showToast('Product deleted from list.', 'error');
      closeModal();
      
      if (activeTab === 'imports') {
        fetchSavedProducts();
      } else {
        fetchSavedProducts().then(applyFilters);
      }
    } else {
      showToast('Deletion failed', 'error');
    }
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('Failed to contact server', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  CSV STORE EXPORTS
// ═══════════════════════════════════════════════════════════
function triggerExport(format) {
  // Verify saved list size
  if (savedProducts.length === 0) {
    alert('Please save some products first before exporting.');
    return;
  }
  
  // Point browser window to download endpoint
  window.location.href = `/api/export?format=${format}`;
}

// ═══════════════════════════════════════════════════════════
//  GOOGLE DRIVE BACKUP FRONTEND INTERACTION
// ═══════════════════════════════════════════════════════════

// Fetch current backup configuration status from Express backend
async function checkBackupStatus() {
  try {
    const res = await fetch('/api/backup/status');
    const data = await res.json();

    const badge = document.getElementById('drive-status-badge');
    const syncBtn = document.getElementById('btn-drive-sync');
    const emailContainer = document.getElementById('service-email-container');
    const emailField = document.getElementById('service-account-email');

    if (!badge || !syncBtn) return;

    if (data.success) {
      if (data.configured) {
        // Connected & Ready
        badge.className = 'status-badge status-ready';
        badge.textContent = 'Connected & Ready';
        syncBtn.disabled = false;
        
        if (data.clientEmail) {
          emailField.textContent = data.clientEmail;
          emailContainer.style.display = 'block';
        } else {
          emailContainer.style.display = 'none';
        }
      } else {
        // Unconfigured
        badge.className = 'status-badge status-unconfigured';
        badge.textContent = 'Unconfigured';
        syncBtn.disabled = true;

        if (data.clientEmail) {
          // Credentials exist but folder ID or share permissions missing
          emailField.textContent = data.clientEmail;
          emailContainer.style.display = 'block';
          badge.textContent = 'Folder Missing / Share required';
        } else {
          // No credentials file at all
          emailContainer.style.display = 'none';
        }
      }
    }
  } catch (error) {
    console.error('Error checking Google Drive backup status:', error);
  }
}

// Trigger database sync to Google Drive folder
async function syncToGoogleDrive() {
  const syncBtn = document.getElementById('btn-drive-sync');
  if (!syncBtn || syncBtn.disabled) return;

  const originalText = syncBtn.textContent;
  syncBtn.disabled = true;
  syncBtn.textContent = '🔄 Syncing...';

  try {
    const res = await fetch('/api/backup/trigger', {
      method: 'POST'
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(data.message || 'Database backed up to Google Drive!');
    } else {
      showToast(data.message || 'Drive backup failed.', 'error');
      alert(`Google Drive Backup Error: ${data.message || 'Unknown error'}\n\nVerify that:\n1. Your Google Service Account key is placed in data/credentials.json\n2. The Folder ID in your .env file is correct\n3. You shared the folder with the service account email!`);
    }
  } catch (error) {
    console.error('Error backing up to Google Drive:', error);
    showToast('Drive backup connection error.', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = originalText;
  }
}

// Toggle product source filter (Amazon/eBay/Walmart) in Explorer view
function toggleSourceFilter(source) {
  // If clicking active filter, clear it. Otherwise, set it.
  if (activeSourceFilter === source) {
    activeSourceFilter = null;
  } else {
    activeSourceFilter = source;
  }

  // Update visual active classes on header filter buttons
  document.querySelectorAll('.filter-badge').forEach(btn => {
    btn.classList.remove('active');
  });

  if (activeSourceFilter) {
    const activeBtn = document.getElementById(`btn-filter-${activeSourceFilter}`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  // Apply filters and refresh grid
  applyFilters();
}

// -----------------------------------------------------------
//  AUTO-UPDATE ENGINE
// -----------------------------------------------------------

function initAutoUpdateUI() {
  // Set select to saved value if any
  const saved = localStorage.getItem('au_interval');
  if (saved) {
    autoIntervalSec = parseInt(saved);
    const sel = document.getElementById('auto-interval-select');
    if (sel) sel.value = String(autoIntervalSec);
  }
  updateTickerUI();
}

// -- TOGGLE AUTO-UPDATE ON / OFF --
function toggleAutoUpdate() {
  if (!autoUpdateActive) {
    startAutoUpdate();
  } else if (!autoUpdatePaused) {
    pauseAutoUpdate();
  } else {
    resumeAutoUpdate();
  }
}

function startAutoUpdate() {
  autoUpdateActive = true;
  autoUpdatePaused = false;
  autoCountdownSec = autoIntervalSec;
  autoRefreshCount = 0;
  autoTotalFetched = 0;

  // Immediately fetch products on start
  triggerAutoFetch();
  // Start countdown ticker
  startCountdownTick();

  updateTickerUI();
  showToast('Auto-Update Started! Refreshing every ' + formatTime(autoIntervalSec), 'success');
}

function pauseAutoUpdate() {
  autoUpdatePaused = true;
  if (autoCountdownTimer) clearInterval(autoCountdownTimer);
  updateTickerUI();
  showToast('Auto-Update Paused', 'info');
}

function resumeAutoUpdate() {
  autoUpdatePaused = false;
  startCountdownTick();
  updateTickerUI();
  showToast('Auto-Update Resumed!');
}

function stopAutoUpdate() {
  autoUpdateActive = false;
  autoUpdatePaused = false;
  if (autoCountdownTimer) clearInterval(autoCountdownTimer);
  autoCountdownTimer = null;
  autoCountdownSec = autoIntervalSec;
  updateTickerUI();
}

// -- COUNTDOWN TICK EVERY SECOND --
function startCountdownTick() {
  if (autoCountdownTimer) clearInterval(autoCountdownTimer);
  autoCountdownTimer = setInterval(() => {
    if (autoUpdatePaused) return;
    autoCountdownSec--;
    updateCountdownDisplay();
    if (autoCountdownSec <= 0) {
      // Time to refresh!
      autoCountdownSec = autoIntervalSec;
      updateCountdownDisplay();
      triggerAutoFetch();
    }
  }, 1000);
}

// -- TRIGGER AUTO FETCH --
async function triggerAutoFetch() {
  if (activeTab !== 'explorer') return; // Only auto-refresh on explorer tab

  // Auto-cycle category if enabled
  if (autoCycleEnabled) {
    const nextCat = AUTO_CATEGORIES[autoCycleIndex % AUTO_CATEGORIES.length];
    document.getElementById('category-select').value = nextCat;
    autoCycleIndex++;
    document.getElementById('au-current-cat').textContent = nextCat;
    document.getElementById('ticker-cycle-info').textContent = 
      nextCat.charAt(0).toUpperCase() + nextCat.slice(1) + ' (' + (autoCycleIndex % AUTO_CATEGORIES.length + 1) + '/' + AUTO_CATEGORIES.length + ')';
  } else {
    const currentCat = document.getElementById('category-select').value;
    document.getElementById('au-current-cat').textContent = currentCat;
  }

  autoRefreshCount++;
  document.getElementById('au-refresh-count').textContent = autoRefreshCount;
  document.getElementById('au-last-time').textContent = new Date().toLocaleTimeString();

  // Animate grid refresh
  const grid = document.getElementById('products-grid');
  if (grid) {
    grid.classList.add('refreshing');
    setTimeout(() => grid.classList.remove('refreshing'), 800);
  }

  // Fetch new products silently (without UI loading block)
  await fetchProductsSilent();
}

// -- SILENT FETCH (no loading spinner, no page disruption) --
async function fetchProductsSilent() {
  const keyword = document.getElementById('search-input').value.trim();
  const market = document.getElementById('market-select').value;
  const category = document.getElementById('category-select').value;

  try {
    const url = '/api/fetch-products?keyword=' + encodeURIComponent(keyword) + '&market=' + market + '&category=' + category + '&limit=30';
    const response = await fetch(url);
    const data = await response.json();

    if (!data.success || !data.products?.length) return;

    // Mark new products that weren't in the previous list
    const prevIds = new Set(scrapedProducts.map(p => p.id));
    scrapedProducts = data.products;
    autoTotalFetched += data.products.length;
    document.getElementById('au-total-fetched').textContent = autoTotalFetched;

    applyFilters(prevIds); // pass old IDs to flag new items
    calculateStats(scrapedProducts);

    // Update banner with auto mode
    const srcStr = (data.sources || []).map(s => '<strong>' + s.charAt(0).toUpperCase() + s.slice(1) + '</strong>').join(', ');
    showBanner('mode-banner', 'mode-text', 
      '\uD83D\uDD04 <strong>Auto-Updated #' + autoRefreshCount + ':</strong> ' + data.total + ' products loaded from ' + srcStr + 
      ' &nbsp;|&nbsp; \uD83D\uDD50 ' + new Date().toLocaleTimeString());

    showToast('\uD83D\uDD04 Auto-refreshed! ' + data.total + ' products');
  } catch (e) {
    console.warn('[Auto-Update] Silent fetch failed:', e.message);
  }
}

// -- COUNTDOWN DISPLAY --
function updateCountdownDisplay() {
  const el = document.getElementById('ticker-countdown');
  const bar = document.getElementById('ticker-progress-bar');
  if (!el) return;

  el.textContent = formatTime(autoCountdownSec);

  // Flash orange when under 10 seconds
  if (autoCountdownSec <= 10) {
    el.classList.add('urgent');
  } else {
    el.classList.remove('urgent');
  }

  // Update progress bar (fills as countdown approaches 0)
  if (bar) {
    const pct = (autoCountdownSec / autoIntervalSec) * 100;
    bar.style.width = pct + '%';
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// -- UPDATE ALL TICKER UI ELEMENTS --
function updateTickerUI() {
  const bar = document.getElementById('auto-ticker-bar');
  const pulseDot = document.getElementById('ticker-pulse-dot');
  const label = document.getElementById('ticker-status-label');
  const center = document.getElementById('ticker-center');
  const toggleBtn = document.getElementById('btn-auto-toggle');
  const fetchBtn = document.getElementById('fetch-btn');
  const infoRow = document.getElementById('auto-update-info-row');
  const liveDot = document.getElementById('live-dot');
  const catRow = document.getElementById('au-current-cat');

  if (!bar) return;

  if (!autoUpdateActive) {
    // STOPPED state
    bar.classList.remove('is-active','is-paused');
    pulseDot.className = 'ticker-pulse';
    label.className = 'ticker-label';
    label.textContent = 'Auto-Update: OFF';
    center.className = 'ticker-center';
    toggleBtn.textContent = '\u25B6 Start Auto';
    toggleBtn.className = 'ticker-toggle-btn stopped';
    fetchBtn.classList.remove('auto-active');
    if (infoRow) infoRow.style.display = 'none';
    if (liveDot) liveDot.classList.remove('active');
    document.getElementById('ticker-countdown').textContent = '--:--';
    document.getElementById('ticker-countdown').classList.remove('urgent');
    document.getElementById('ticker-progress-bar').style.width = '100%';
  } else if (autoUpdatePaused) {
    // PAUSED state
    bar.classList.remove('is-active');
    bar.classList.add('is-paused');
    pulseDot.className = 'ticker-pulse paused';
    label.className = 'ticker-label paused';
    label.textContent = 'Auto-Update: PAUSED';
    center.className = 'ticker-center paused';
    toggleBtn.textContent = '\u25B6 Resume';
    toggleBtn.className = 'ticker-toggle-btn paused';
    fetchBtn.classList.remove('auto-active');
    if (liveDot) liveDot.classList.remove('active');
  } else {
    // ACTIVE state
    bar.classList.add('is-active');
    bar.classList.remove('is-paused');
    pulseDot.className = 'ticker-pulse active';
    label.className = 'ticker-label active';
    label.textContent = 'Auto-Update: LIVE';
    center.className = 'ticker-center active';
    toggleBtn.textContent = '\u23F8 Pause';
    toggleBtn.className = 'ticker-toggle-btn';
    fetchBtn.classList.add('auto-active');
    if (infoRow) infoRow.style.display = 'flex';
    if (liveDot) liveDot.classList.add('active');
    if (catRow) catRow.textContent = document.getElementById('category-select').value;
  }
}

// -- CHANGE INTERVAL --
function changeAutoInterval() {
  const sel = document.getElementById('auto-interval-select');
  autoIntervalSec = parseInt(sel.value);
  autoCountdownSec = autoIntervalSec;
  localStorage.setItem('au_interval', autoIntervalSec);

  if (autoUpdateActive && !autoUpdatePaused) {
    startCountdownTick(); // restart timer
  }

  updateCountdownDisplay();
  showToast('Refresh interval set to ' + formatTime(autoIntervalSec));
}

// -- TOGGLE CATEGORY CYCLING --
function toggleCycleCategories() {
  autoCycleEnabled = !autoCycleEnabled;
  const btn = document.getElementById('btn-cycle-toggle');
  const info = document.getElementById('ticker-cycle-info');

  if (autoCycleEnabled) {
    btn.classList.add('active');
    btn.textContent = '\u2713 Cycling ON';
    info.textContent = 'All ' + AUTO_CATEGORIES.length + ' categories';
    showToast('Category cycling ON � will auto-rotate through all categories!');
  } else {
    btn.classList.remove('active');
    btn.textContent = '\uD83D\uDD04 Cycle Categories';
    info.textContent = '';
    showToast('Category cycling OFF');
  }
}
