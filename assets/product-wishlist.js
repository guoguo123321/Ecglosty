/**
 * Product / collection wishlist — stores into ecglosty_wishlist.others
 * Supports:
 * - PDP full button (.product-wishlist-btn)
 * - Collection card heart (.jc-heart-btn / [data-product-wishlist])
 */
(() => {
  if (window.__ecglostyProductWishlistInit) return;
  window.__ecglostyProductWishlistInit = true;

  const WISHLIST_KEY = 'ecglosty_wishlist';

  function getWishlist() {
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.others)) return parsed;
      }
    } catch (e) {}
    return { diamonds: [], others: [] };
  }

  function saveWishlist(wl) {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(wl));
  }

  function getKey(d) {
    return String(d?.productId || d?.id || d?.urlHandle || '');
  }

  function isWishlisted(d) {
    const key = getKey(d);
    if (!key) return false;
    return getWishlist().others.some((item) => getKey(item) === key);
  }

  function readProductData(btn) {
    const uid = btn.getAttribute('data-wishlist-uid');
    if (!uid) return null;
    const dataEl = document.getElementById('product-wishlist-data-' + uid);
    if (!dataEl) return null;
    try {
      return JSON.parse(dataEl.textContent);
    } catch (e) {
      return null;
    }
  }

  function syncBtn(btn) {
    const productData = readProductData(btn);
    if (!productData) return;
    const on = isWishlisted(productData);
    const nextLabel = on ? 'WISHLISTED' : 'ADD TO WISHLIST';
    const nextAria = on ? 'Remove from wishlist' : 'Add to wishlist';
    const nextPressed = on ? 'true' : 'false';

    // Skip identical writes — avoids attribute thrash when MutationObserver re-fires.
    if (btn.classList.contains('wishlisted') !== on) {
      btn.classList.toggle('wishlisted', on);
    }
    const label = btn.querySelector('[data-wishlist-label]');
    if (label && label.textContent !== nextLabel) label.textContent = nextLabel;
    const svg = btn.querySelector('svg');
    if (svg && !label) {
      const nextFill = on ? 'currentColor' : 'none';
      if (svg.getAttribute('fill') !== nextFill) svg.setAttribute('fill', nextFill);
    }
    if (btn.getAttribute('aria-label') !== nextAria) btn.setAttribute('aria-label', nextAria);
    if (btn.getAttribute('aria-pressed') !== nextPressed) btn.setAttribute('aria-pressed', nextPressed);
  }

  function syncAll() {
    document.querySelectorAll('[data-product-wishlist]').forEach(syncBtn);
  }

  function toggleWishlist(btn) {
    const productData = readProductData(btn);
    if (!productData) return;
    const wl = getWishlist();
    const key = getKey(productData);
    const idx = wl.others.findIndex((item) => getKey(item) === key);
    if (idx >= 0) {
      wl.others.splice(idx, 1);
    } else {
      wl.others.push(productData);
    }
    saveWishlist(wl);
    syncAll();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product-wishlist]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(btn);
  });

  window.addEventListener('ecglosty:wishlist-updated', syncAll);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAll);
  } else {
    syncAll();
  }

  document.addEventListener('shopify:section:load', syncAll);

  // Only watch product/collection roots — NOT documentElement.
  // Judge.me / apps mutate the whole tree; a document MO + syncAll = CSS thrash loop.
  let morphTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(morphTimer);
    morphTimer = setTimeout(syncAll, 120);
  });
  const observeRoots = () => {
    document
      .querySelectorAll(
        'product-information, .shopify-product-information, .product-details, product-recommendations, #ResultsList, .product-grid-container'
      )
      .forEach((root) => {
        observer.observe(root, { childList: true, subtree: true });
      });
  };
  observeRoots();
  document.addEventListener('shopify:section:load', observeRoots);

  window.ecglostySyncProductWishlist = syncAll;
})();
