// ═══════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════
let activeTab = 'explorer';
let scrapedProducts = [];
let savedProducts = [];
let currentEditingProduct = null;

// ═══════════════════════════════════════════════════════════
//  APP INITIALIZATION
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Sync the total saved count badge on load
  updateSavedCountBadge();

  // Handle enter key on search input
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      fetchProducts();
    }
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
  }
}

// ═══════════════════════════════════════════════════════════
//  FETCH PRODUCTS (EXPLORER)
// ═══════════════════════════════════════════════════════════
async function fetchProducts() {
  const keyword = document.getElementById('search-input').value.trim();
  const market = document.getElementById('market-select').value;
  const category = document.getElementById('category-select').value;

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

    // Show Demo mode warning if backend is running in demo mode
    if (data.mode === 'demo') {
      showBanner('mode-banner', 'mode-text', `<strong>Demo Mode Active:</strong> No RapidAPI key is configured in your backend <code>.env</code> file. Showing live scraped results from <strong>eBay</strong> alongside simulated hot products from <strong>Amazon</strong> & <strong>Walmart</strong>. Add your RapidAPI key to unlock full live requests.`);
    } else {
      showBanner('mode-banner', 'mode-text', `<strong>Live Mode Connected:</strong> Successfully fetched real-time trending products from live e-commerce databases.`);
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
function applyFilters() {
  const sortBy = document.getElementById('sort-select').value;
  let products = [...scrapedProducts];

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

  renderProductsGrid(products, 'products-grid', false);
  
  if (products.length > 0) {
    document.getElementById('products-section').style.display = 'block';
    document.getElementById('results-header').style.display = 'flex';
    document.getElementById('result-count').textContent = `${products.length} products found`;
  } else {
    document.getElementById('products-section').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  RENDER PRODUCTS GRID
// ═══════════════════════════════════════════════════════════
function renderProductsGrid(products, gridId, isSavedGrid) {
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
  
  if (type === 'error') {
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
