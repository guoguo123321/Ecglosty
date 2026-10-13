/**
 * Header wishlist icon: reads from localStorage key `ecglosty_wishlist`
 * Shape: { diamonds: [], others: [] }
 * Shows a small dot when count > 0 (no numeric badge).
 */
(() => {
  if (window.__ecglostyWishlistHeaderInit) return;
  window.__ecglostyWishlistHeaderInit = true;

  const WISHLIST_KEY = 'ecglosty_wishlist';

  function getCount() {
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      const diamonds = Array.isArray(parsed?.diamonds) ? parsed.diamonds.length : 0;
      const others = Array.isArray(parsed?.others) ? parsed.others.length : 0;
      return diamonds + others;
    } catch (e) {
      return 0;
    }
  }

  function updateIcon(root) {
    const count = getCount();
    const dot = root.querySelector('[data-wishlist-dot]');
    if (dot) {
      dot.classList.toggle('visually-hidden', count === 0);
    }
    root.classList.toggle('header-actions__wishlist--has-items', count > 0);
    root.setAttribute('aria-label', count > 0 ? `Wishlist, ${count} items` : 'Wishlist');
  }

  function updateAll() {
    document.querySelectorAll('[data-header-wishlist]').forEach(updateIcon);
  }

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.apply(this, arguments);
    if (key === WISHLIST_KEY) {
      window.dispatchEvent(new CustomEvent('ecglosty:wishlist-updated'));
    }
  };

  window.addEventListener('ecglosty:wishlist-updated', updateAll);
  window.addEventListener('storage', (e) => {
    if (e.key === WISHLIST_KEY) updateAll();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateAll);
  } else {
    updateAll();
  }

  window.ecglostyUpdateWishlistHeader = updateAll;
})();
