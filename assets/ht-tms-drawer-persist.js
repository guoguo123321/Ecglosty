/**
 * Keep Hextom Translate & Currency visible in the mobile menu drawer.
 *
 * Hextom injects into `header-drawer .menu-drawer__utility-links` via
 * customCSSPositionConfig. Horizon header hydration / DOM churn can remove it;
 * Hextom may also set [hidden] while moving between desktop/mobile targets.
 */
(() => {
  const MOUNT_SELECTOR = '#ht-tms-drawer-selector, [data-ht-tms-drawer-mount], header-drawer .menu-drawer__utility-links';
  const HT_NODE_SELECTOR =
    '.ht-tms__duo-selector, .ht-tms-single-dropdown__container, .ht-tms-single-selector, .ht-tms-selector, [class*="ht-tms"]';
  const DESKTOP_SOURCE_SELECTOR =
    '[data-testid="header-top-right"] .ht-tms-selector, [data-testid="header-top-right"] [class*="ht-tms"], header .ht-tms-selector, header [class*="ht-tms"]';

  /** @type {string | null} */
  let stashHtml = null;
  /** @type {MutationObserver | null} */
  let mountObserver = null;
  /** @type {MutationObserver | null} */
  let headerObserver = null;
  /** @type {HTMLElement | null} */
  let observedMount = null;
  let restoreQueued = false;
  let restoring = false;

  /**
   * @param {ParentNode | Document | null | undefined} root
   * @returns {HTMLElement | null}
   */
  function getMount(root = document) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const mount = root.querySelector(MOUNT_SELECTOR);
    return mount instanceof HTMLElement ? mount : null;
  }

  /**
   * @param {HTMLElement} mount
   * @returns {Element[]}
   */
  function getHtNodes(mount) {
    return Array.from(mount.querySelectorAll(HT_NODE_SELECTOR)).filter((node) => {
      // Prefer top-level injected roots only.
      return !node.parentElement?.closest(HT_NODE_SELECTOR);
    });
  }

  /**
   * @param {HTMLElement} mount
   * @returns {boolean}
   */
  function hasHtContent(mount) {
    return getHtNodes(mount).length > 0;
  }

  /**
   * @param {HTMLElement} el
   */
  function unhide(el) {
    el.removeAttribute('hidden');
    if (el.style.display === 'none') el.style.removeProperty('display');
    if (el.style.visibility === 'hidden') el.style.removeProperty('visibility');
    if (el.style.opacity === '0') el.style.removeProperty('opacity');
  }

  /**
   * @param {HTMLElement} mount
   */
  function revealMountContent(mount) {
    unhide(mount);
    mount.querySelectorAll(HT_NODE_SELECTOR).forEach((node) => {
      if (node instanceof HTMLElement) unhide(node);
    });
  }

  /**
   * @param {HTMLElement} mount
   */
  function snapshot(mount) {
    if (!hasHtContent(mount)) return;
    revealMountContent(mount);
    stashHtml = mount.innerHTML;
  }

  /**
   * @returns {string | null}
   */
  function captureFromDesktop() {
    const nodes = Array.from(document.querySelectorAll(DESKTOP_SOURCE_SELECTOR)).filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest(MOUNT_SELECTOR)) return false;
      return !node.parentElement?.closest(HT_NODE_SELECTOR);
    });
    if (!nodes.length) return null;

    const wrap = document.createElement('div');
    nodes.forEach((node) => {
      const clone = /** @type {HTMLElement} */ (node.cloneNode(true));
      unhide(clone);
      wrap.appendChild(clone);
    });
    return wrap.innerHTML || null;
  }

  /**
   * @param {HTMLElement} mount
   * @returns {boolean}
   */
  function restore(mount) {
    const html = stashHtml || captureFromDesktop();
    if (!html || hasHtContent(mount)) return false;

    restoring = true;
    try {
      mount.innerHTML = html;
      revealMountContent(mount);
      stashHtml = mount.innerHTML;
      return hasHtContent(mount);
    } finally {
      restoring = false;
    }
  }

  function tryHextomRemount() {
    const api = window.tms;
    if (!api || typeof api !== 'object') return;

    const candidates = [
      api.remountSelector,
      api.mountSelector,
      api.initSelector,
      api.renderSelector,
      api.refreshSelector,
      api.selectorApi?.remount,
      api.selectorApi?.init,
      api.selectorApi?.render,
      api.selectorApi?.refresh,
    ];

    for (const fn of candidates) {
      if (typeof fn === 'function') {
        try {
          fn.call(api.selectorApi || api);
          return;
        } catch {
          // ignore vendor API errors
        }
      }
    }

    // Nudge Hextom's breakpoint/placement logic if present.
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {
      // ignore
    }
  }

  /**
   * @param {HTMLElement} mount
   */
  function observeMount(mount) {
    if (observedMount === mount && mountObserver) return;

    mountObserver?.disconnect();
    observedMount = mount;
    mount.setAttribute('data-morph-skip', '');
    mount.setAttribute('data-ht-tms-drawer-mount', '');

    mountObserver = new MutationObserver(() => {
      if (restoring) return;
      if (hasHtContent(mount)) {
        snapshot(mount);
        revealMountContent(mount);
        return;
      }
      queueEnsure();
    });

    mountObserver.observe(mount, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
    });
  }

  function observeHeader() {
    if (headerObserver) return;
    const header = document.querySelector('header-drawer, .header-section, #header-group');
    if (!header) return;

    headerObserver = new MutationObserver(() => {
      if (restoring) return;
      queueEnsure();
    });

    headerObserver.observe(header, { childList: true, subtree: true });
  }

  function ensureSelector() {
    const mount = getMount();
    if (!mount) return;

    observeMount(mount);
    revealMountContent(mount);

    if (hasHtContent(mount)) {
      snapshot(mount);
      return;
    }

    if (restore(mount)) return;
    tryHextomRemount();

    // After remount nudge, snapshot if Hextom filled it.
    requestAnimationFrame(() => {
      const latest = getMount();
      if (latest && hasHtContent(latest)) snapshot(latest);
    });
  }

  function queueEnsure() {
    if (restoreQueued) return;
    restoreQueued = true;
    requestAnimationFrame(() => {
      restoreQueued = false;
      ensureSelector();
    });
  }

  function bindDrawerOpen() {
    document.addEventListener(
      'toggle',
      (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement)) return;
        if (!details.classList.contains('menu-drawer-container') && !String(details.id || '').includes('menu-drawer')) {
          return;
        }
        if (!details.open) return;
        queueEnsure();
        setTimeout(ensureSelector, 50);
        setTimeout(ensureSelector, 200);
        setTimeout(ensureSelector, 600);
        setTimeout(ensureSelector, 1200);
      },
      true
    );

    // header-drawer open also toggles .menu-open without always relying on toggle alone.
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('summary.header__icon--menu, .header__icon--menu')) return;
        setTimeout(ensureSelector, 50);
        setTimeout(ensureSelector, 300);
        setTimeout(ensureSelector, 800);
      },
      true
    );
  }

  function init() {
    ensureSelector();
    observeHeader();
    document.addEventListener('theme:morph:done', queueEnsure);
    bindDrawerOpen();

    [200, 600, 1200, 2500, 5000, 8000].forEach((ms) => setTimeout(ensureSelector, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
