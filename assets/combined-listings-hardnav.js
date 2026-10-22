/**
 * Soft-navigate Combined Listings (Grouptify / mpg) product switches.
 * Updates the product URL + #MainContent while reusing the .mpg-swatch DOM.
 *
 * Prefetch reachable products and primary images; reuse parsed responses for 30s.
 * Resolve full group combinations and render the exact persisted Shopify variant.
 * Only the latest navigation may commit; preserve the live swatch and its focus.
 */
(function () {
  const NAV_CLASS = 'mpg-soft-navigating';
  const HANDLED_ATTR = 'data-mpg-soft-nav-at';
  /**
   * Soft DOM updates (even URL-only + swatch class) still cause visible CSS jitter
   * with Shop Pay / sticky / Grouptify. Prefer preserve-swatch body swap.
   * Request failures keep the current product visible; hard navigation is opt-in.
   */
  const HARD_NAV_ONLY = false;

  /** @type {AbortController | null} */
  let activeController = null;
  /** @type {boolean} */
  let navigating = false;
  let navigationId = 0;
  const CACHE_TTL = 30000;
  const CACHE_LIMIT = 40;
  const responseCache = new Map();
  let prefetchQueue = [];
  let prefetchCount = 0;
  let prefetchTimer;
  let prefetchSignature = '';
  let prefetchPausedUntil = 0;
  let requestPausedUntil = 0;
  let prefetchPumpTimer;
  let renderedUrl = window.location.href;
  const busyElements = new Map();
  const warmedDocuments = new WeakSet();
  let secondaryRefreshTimer;

  function getProductSection() {
    return document.querySelector('#MainContent .product-information')?.closest('.shopify-section') || null;
  }

  function readProductState(root) {
    const text = root.querySelector('script[data-product-switch-state]')?.textContent;
    if (!text) return null;
    try {
      const product = JSON.parse(text);
      return product?.id && product.handle && product.variants?.length ? product : null;
    } catch {
      return null;
    }
  }

  function resolveGroupSelections(handle, selections) {
    const group = window.mpg?.group;
    const target = group?.products?.find((product) => sameHandle(product.handle, handle));
    if (!target || !Array.isArray(group.options)) return selections;
    const next = [...selections];
    for (const option of group.options) {
      const value = option.values?.find((value) => target.options?.includes(value.id));
      if (!value?.name || !option.name) continue;
      const name = option.name.trim();
      const index = next.findIndex((selection) => selection.name.trim().toLowerCase() === name.toLowerCase());
      const selection = { name, value: value.name.trim() };
      if (index >= 0) next[index] = selection;
      else next.push(selection);
    }
    return next;
  }

  /** Warm the visible image, including the custom gallery's JSON-owned first image. */
  function warmPrimaryImage(doc) {
    if (warmedDocuments.has(doc)) return;
    warmedDocuments.add(doc);
    const nativeImage = doc.querySelector('media-gallery .product-media__image');
    let customUrl = '';
    if (!nativeImage) {
      // This literal assignment is rendered by product-media-gallery-content.liquid.
      // Parse only JSON; never execute scripts from a speculative response.
      for (const script of doc.querySelectorAll('script:not([src])')) {
        const match = script.textContent?.match(/\bvar rawData = ([^\r\n]+);/);
        if (!match) continue;
        try {
          let data = JSON.parse(match[1]);
          if (typeof data === 'string') data = JSON.parse(data.replace(/,\s*([}\]])/g, '$1'));
          const media = [...(data?.medias || [])].sort((a, b) => a.sortOrder - b.sortOrder)
            .find((item) => item.mediaType !== 5 && item.mediaType !== 6);
          if (media?.mediaType === 1) customUrl = media.url || '';
          if (media?.mediaType === 4 && media.url && media.imageName) {
            customUrl = `${media.url}${media.imageName}1.${media.imageSuffix || 'webp'}`;
          }
        } catch {
          // Invalid/unsupported media remains the gallery's responsibility.
        }
        break;
      }
    }
    if (!nativeImage && !customUrl) return;
    const image = new Image();
    image.fetchPriority = 'low';
    if (nativeImage?.sizes) image.sizes = nativeImage.sizes;
    if (nativeImage?.srcset) image.srcset = nativeImage.srcset;
    image.src = nativeImage?.src || customUrl;
  }

  /** Share pending requests as well as completed responses; failed responses are never cached. */
  function cachedResponse(url, type, priority = 'high', productId = null) {
    const key = `${window.Shopify?.currency?.active || ''}:${url}`;
    const existing = responseCache.get(key);
    if (existing && existing.expires > Date.now()) {
      responseCache.delete(key);
      responseCache.set(key, existing);
      return existing.promise;
    }
    if (Date.now() < requestPausedUntil) return Promise.reject(new Error('Product requests are temporarily paused'));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const entry = { expires: Infinity, promise: null };
    entry.promise = fetch(url, { credentials: 'same-origin', signal: controller.signal, priority })
      .then(async (response) => {
        if (!response.ok) {
          const retryAfter = response.headers?.get('Retry-After');
          const seconds = Number(retryAfter);
          const retryAt = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : Date.now() + seconds * 1000;
          if (response.status === 429 || response.status === 430 || retryAfter) {
            requestPausedUntil = Math.max(requestPausedUntil, Date.now() + 30000, retryAt || 0);
          }
          const error = new Error(`Product request failed: ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const result = type === 'json' ? await response.json() :
          new DOMParser().parseFromString(await response.text(), 'text/html');
        if (type !== 'json') {
          const sectionId = new URL(url, window.location.origin).searchParams.get('section_id');
          const main = sectionId ? result.getElementById(`shopify-section-${sectionId}`) : result.getElementById('MainContent');
          if (!main) {
            const error = new Error('MainContent missing');
            error.code = 'missing-product-root';
            throw error;
          }
          const productNode = main.querySelector('variant-picker[data-product-id], product-form-component[data-product-id]');
          if (!productNode && !main.querySelector('.dpi-rp__info')) throw new Error('Product content missing');
          if (productNode && productId != null && String(productNode.dataset.productId) !== String(productId)) {
            throw new Error('Product content does not match target');
          }
        }
        if (type === 'json' && (!result?.id || !Array.isArray(result.variants) || !result.variants.length)) {
          throw new Error('Product data missing');
        }
        entry.expires = Date.now() + CACHE_TTL;
        return result;
      })
      .catch((error) => {
        prefetchPausedUntil = Math.max(prefetchPausedUntil, Date.now() + 30000, requestPausedUntil);
        prefetchQueue = [];
        if (responseCache.get(key) === entry) responseCache.delete(key);
        throw error;
      })
      .finally(() => window.clearTimeout(timeout));
    responseCache.set(key, entry);
    while (responseCache.size > CACHE_LIMIT) responseCache.delete(responseCache.keys().next().value);
    return entry.promise;
  }

  /** Cancel a navigation's wait without cancelling a request shared with prefetch/another click. */
  function waitForResponse(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Superseded navigation', 'AbortError'));
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  /** Request server-rendered state for the exact variant, including price, stock and checkout. */
  async function loadProduct(handle, selections, priority = 'high', preferredVariantId = null) {
    selections = resolveGroupSelections(handle, selections);
    const section = getProductSection();
    if (section && readProductState(section)) {
      const sectionId = section.id.replace(/^shopify-section-/, '');
      const requestUrl = buildProductUrl(handle, { variantId: preferredVariantId });
      requestUrl.searchParams.set('section_id', sectionId);
      let doc;
      try {
        doc = await cachedResponse(requestUrl.toString(), 'html', priority);
      } catch (error) {
        // Different product templates may not have this section ID; retain the full-page path.
        if (error.status !== 404 && error.code !== 'missing-product-root') throw error;
      }
      const product = doc ? readProductState(doc) : null;
      if (product && sameHandle(product.handle, handle)) {
        const preferred = product.variants.find((variant) => String(variant.id) === preferredVariantId);
        const variantId = preferred ? String(preferred.id) :
          matchVariantId(product, selections) || String(product.selected_variant_id);
        const finalUrl = buildProductUrl(handle, { variantId });
        if (String(product.selected_variant_id) !== variantId) {
          const exactUrl = new URL(finalUrl);
          exactUrl.searchParams.set('section_id', sectionId);
          doc = await cachedResponse(exactUrl.toString(), 'html', priority, product.id);
        }
        if (String(readProductState(doc)?.selected_variant_id) !== variantId) {
          throw new Error('Product variant does not match target');
        }
        warmPrimaryImage(doc);
        return { product, doc, finalUrl, variantId, sectionId };
      }
    }
    const url = buildProductUrl(handle);
    const jsonUrl = new URL(`${window.Shopify?.routes?.root || '/'}products/${encodeURIComponent(handle)}.js`, url.origin);
    const product = await cachedResponse(jsonUrl.toString(), 'json', priority);
    const preferred = product.variants?.find((variant) => String(variant.id) === preferredVariantId);
    const defaultVariant = product.variants?.find((variant) => variant.available) || product.variants?.[0];
    const variantId = preferred ? String(preferred.id) :
      matchVariantId(product, selections) || (defaultVariant?.id != null ? String(defaultVariant.id) : null);
    const finalUrl = buildProductUrl(handle, { variantId });
    const doc = await cachedResponse(finalUrl.toString(), 'html', priority, product.id);
    warmPrimaryImage(doc);
    return { product, doc, finalUrl, variantId };
  }

  /** Keep stale purchase controls inactive while the swatch remains available for another choice. */
  function setNavigationBusy(busy) {
    if (!busy) {
      for (const [element, inert] of busyElements) element.inert = inert;
      busyElements.clear();
      document.getElementById('MainContent')?.removeAttribute('aria-busy');
      return;
    }
    document.getElementById('MainContent')?.setAttribute('aria-busy', 'true');
    document.querySelectorAll('#MainContent product-form-component, #MainContent variant-picker, #MainContent sticky-add-to-cart').forEach((element) => {
      if (!busyElements.has(element)) busyElements.set(element, element.inert);
      element.inert = true;
    });
  }

  function canPrefetch() {
    const connection = navigator.connection;
    return Date.now() >= prefetchPausedUntil && !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType || '');
  }

  /** Warm a small set of reachable combinations; intent can prioritize other options. */
  function schedulePrefetch() {
    if (!canPrefetch() || document.readyState === 'loading' || navigating) return;
    const swatch = getSwatchEl();
    if (!swatch) return;
    const selections = captureThemeOptionSelections();
    const handles = [...new Set(Array.from(swatch.querySelectorAll('.mpg-swatch__option[v-id]'))
      .filter((option) => !option.classList.contains('blocked') && option.getAttribute('aria-disabled') !== 'true')
      .map(resolveHandleFromOption).filter(Boolean))]
      .filter((handle) => !sameProductPath(buildProductUrl(handle).pathname, window.location.pathname)).slice(0, 4);
    const signature = JSON.stringify([window.location.pathname, selections, handles]);
    if (signature === prefetchSignature) return;
    prefetchSignature = signature;
    prefetchQueue = handles.map((handle) => ({ handle, selections }));
    pumpPrefetch();
  }

  function pumpPrefetch() {
    if (prefetchPumpTimer || !canPrefetch()) return;
    if (!navigating && prefetchCount < 1 && prefetchQueue.length) {
      const { handle, selections } = prefetchQueue.shift();
      prefetchCount++;
      loadProduct(handle, selections, 'low').catch(() => {
        // Retry normally on click; speculative failures must never navigate the page.
      }).finally(() => {
        prefetchCount--;
        prefetchPumpTimer = window.setTimeout(() => {
          prefetchPumpTimer = undefined;
          pumpPrefetch();
        }, 750);
      });
    }
  }

  function prefetchOption(event) {
    if (!canPrefetch() || !(event.target instanceof Element)) return;
    const option = event.target.closest('.mpg-swatch:not(.mpg-card) .mpg-swatch__option[v-id]');
    if (!option || option.classList.contains('blocked') || option.getAttribute('aria-disabled') === 'true') return;
    const handle = resolveHandleFromOption(option);
    if (!handle || sameProductPath(buildProductUrl(handle).pathname, window.location.pathname)) return;
    prefetchQueue = prefetchQueue.filter((item) => item.handle !== handle);
    prefetchQueue.unshift({ handle, selections: captureThemeOptionSelections() });
    prefetchQueue.length = Math.min(prefetchQueue.length, 4);
    pumpPrefetch();
  }

  /**
   * FAQ/fold scripts bind on DOMContentLoaded. Soft-nav / morph re-run after that
   * event already fired, so rewrite listeners to this helper.
   * @param {EventListener | (() => void)} fn
   */
  function runWhenDomReady(fn) {
    if (typeof fn !== 'function') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      queueMicrotask(fn);
    }
  }

  // Expose early so re-executed <script type="module"> can call it.
  window.__mpgSoftNav = window.__mpgSoftNav || {};
  window.__mpgSoftNav.runWhenDomReady = runWhenDomReady;

  function isProductPage() {
    return /\/products\//.test(window.location.pathname);
  }

  function getSwatchEl() {
    return document.querySelector('.mpg-swatch:not(.mpg-card)');
  }

  /**
   * @param {string | null | undefined} value
   * @returns {string}
   */
  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || '').trim());
    } catch {
      return String(value || '').trim();
    }
  }

  /**
   * @param {string | null | undefined} a
   * @param {string | null | undefined} b
   * @returns {boolean}
   */
  function sameHandle(a, b) {
    return safeDecode(a) === safeDecode(b);
  }

  function findThroneTarget(root) {
    const scope = root || document;
    const selectors = [
      '.dpi-rp__info',
      '.dpi-rp__specs',
      'variant-picker',
      '.buy-buttons-block',
      'product-form-component',
      'form[action="/cart/add"]:not(.installments form[action="/cart/add"])',
      'product-price',
      '.product-details',
    ];

    for (const selector of selectors) {
      const el = scope.querySelector(selector);
      if (el instanceof HTMLElement) return el;
    }
    return null;
  }

  function normalizePathname(pathname) {
    try {
      return decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
    } catch {
      return String(pathname || '').replace(/\/+$/, '') || '/';
    }
  }

  function sameProductPath(a, b) {
    return normalizePathname(a) === normalizePathname(b);
  }

  /**
   * @param {string} productHandle
   * @param {{ variantId?: string | null }} [opts]
   * @returns {URL}
   */
  function buildProductUrl(productHandle, opts = {}) {
    const handle = safeDecode(productHandle);
    let baseUrl = window.location.href;
    if (!baseUrl.includes('/products/')) {
      baseUrl = `${window.location.origin}/products/${encodeURIComponent(handle)}`;
    }

    const swapped =
      typeof window.mpg?.swapProductHandle === 'function'
        ? window.mpg.swapProductHandle(baseUrl, handle)
        : baseUrl.replace(/\/products\/[^/?#]+/, `/products/${encodeURIComponent(handle)}`);

    const url = new URL(swapped, window.location.origin);
    url.searchParams.delete('mpgsh');
    url.hash = '';

    if (opts.variantId) {
      url.searchParams.set('variant', String(opts.variantId));
    } else {
      url.searchParams.delete('variant');
    }

    return url;
  }

  /**
   * Read currently selected Combined Listings value ids (one per option-set).
   * @param {Element | null} [swatch]
   * @returns {string[]}
   */
  function getSelectedGroupValueIds(swatch) {
    const root = swatch || getSwatchEl();
    if (!root) return [];

    /** @type {string[]} */
    const ids = [];
    root.querySelectorAll('.mpg-swatch__option-set').forEach((set) => {
      const selected =
        set.querySelector('.mpg-swatch__option.selected[v-id], .mpg-swatch__option[aria-checked="true"][v-id]') ||
        set.querySelector('.mpg-swatch__option[v-id].selected');
      const valueId = selected?.getAttribute('v-id');
      if (valueId) ids.push(valueId);
    });

    // Fallback: flat selected options when option-set markup is missing
    if (!ids.length) {
      root.querySelectorAll('.mpg-swatch__option.selected[v-id], .mpg-swatch__option[aria-checked="true"][v-id]').forEach((node) => {
        const valueId = node.getAttribute('v-id');
        if (valueId && !ids.includes(valueId)) ids.push(valueId);
      });
    }

    return ids;
  }

  /**
   * Build desired value-id combination after clicking an option.
   * @param {Element} clickedOption
   * @returns {string[]}
   */
  function getDesiredValueIds(clickedOption) {
    const swatch = clickedOption.closest('.mpg-swatch') || getSwatchEl();
    const clickedId = clickedOption.getAttribute('v-id');
    const optionSet = clickedOption.closest('.mpg-swatch__option-set');

    /** @type {string[]} */
    const desired = [];

    if (swatch && optionSet) {
      swatch.querySelectorAll('.mpg-swatch__option-set').forEach((set) => {
        if (set === optionSet) {
          if (clickedId) desired.push(clickedId);
          return;
        }
        const selected = set.querySelector(
          '.mpg-swatch__option.selected[v-id], .mpg-swatch__option[aria-checked="true"][v-id]'
        );
        const valueId = selected?.getAttribute('v-id');
        if (valueId) desired.push(valueId);
      });
      return desired;
    }

    // No option-set: keep other selected ids, swap any id from same o-name axis
    const current = getSelectedGroupValueIds(swatch);
    const oName = clickedOption.getAttribute('o-name');
    if (oName && swatch) {
      const axisIds = new Set(
        Array.from(swatch.querySelectorAll(`.mpg-swatch__option[o-name="${CSS.escape(oName)}"][v-id]`)).map((el) =>
          el.getAttribute('v-id')
        )
      );
      current.forEach((id) => {
        if (!axisIds.has(id)) desired.push(id);
      });
    } else {
      desired.push(...current.filter((id) => id !== clickedId));
    }
    if (clickedId) desired.push(clickedId);
    return desired;
  }

  /**
   * Find group product whose options exactly match the desired value ids.
   * @param {string[]} desiredIds
   * @returns {object | null}
   */
  function findProductByValueIds(desiredIds) {
    const products = window.mpg?.group?.products;
    if (!Array.isArray(products) || !desiredIds.length) return null;

    const desired = new Set(desiredIds);

    const exact = products.find((item) => {
      if (!Array.isArray(item?.options) || item.options.length !== desired.size) return false;
      return item.options.every((id) => desired.has(id));
    });
    if (exact) return exact;

    // Prefer products that include every desired id (order / extra ids tolerant)
    const inclusive = products.find(
      (item) => Array.isArray(item?.options) && desiredIds.every((id) => item.options.includes(id))
    );
    return inclusive || null;
  }

  /**
   * Resolve product handle from a clicked swatch option using full combination.
   * @param {Element} option
   * @returns {string}
   */
  function resolveHandleFromOption(option) {
    const desiredIds = getDesiredValueIds(option);
    const matched = findProductByValueIds(desiredIds);
    if (matched?.handle) return safeDecode(matched.handle);

    // Fallback: onclick handle (may be stale after soft-nav DOM reuse)
    const onclick = option.getAttribute('onclick') || '';
    const match = onclick.match(/redirectToProductPage\(\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return safeDecode(match[1]);

    const valueId = option.getAttribute('v-id');
    if (valueId && Array.isArray(window.mpg?.group?.products)) {
      // Last resort: products containing this value, prefer ones also matching other selected ids
      const selectedOthers = getSelectedGroupValueIds().filter((id) => id !== valueId);
      const candidates = window.mpg.group.products.filter(
        (item) => Array.isArray(item.options) && item.options.includes(valueId)
      );
      candidates.sort((a, b) => {
        const score = (p) => selectedOthers.filter((id) => p.options.includes(id)).length;
        return score(b) - score(a);
      });
      if (candidates[0]?.handle) return safeDecode(candidates[0].handle);
    }

    return safeDecode(
      option.getAttribute('data-product-handle') ||
        option.getAttribute('handle') ||
        option.getAttribute('p-handle') ||
        ''
    );
  }

  /**
   * Capture theme variant selections (Shopify options, not mpg group options).
   * @returns {{ name: string, value: string }[]}
   */
  function captureThemeOptionSelections() {
    /** @type {{ name: string, value: string }[]} */
    const selections = [];
    const picker = document.querySelector('variant-picker');
    if (!picker) return selections;

    picker.querySelectorAll('fieldset.variant-option').forEach((fieldset) => {
      const legend = fieldset.querySelector('legend');
      const name = (legend?.textContent || fieldset.getAttribute('data-option-name') || '').trim();
      const checked = fieldset.querySelector('input:checked, [aria-checked="true"]');
      let value = '';
      if (checked instanceof HTMLInputElement) value = checked.value;
      else if (checked instanceof HTMLElement) {
        value = checked.getAttribute('data-value') || checked.getAttribute('value') || checked.textContent || '';
      }
      value = value.trim();
      if (name && value) selections.push({ name, value });
    });

    picker.querySelectorAll('select').forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) return;
      const label =
        select.closest('.variant-option')?.querySelector('label')?.textContent ||
        select.getAttribute('name') ||
        '';
      const name = label.replace(/:\s*$/, '').trim();
      const value = select.value?.trim();
      if (name && value && !selections.some((s) => s.name === name)) {
        selections.push({ name, value });
      }
    });

    return selections;
  }

  /**
   * Find a variant id on product JSON that matches previously selected option values.
   * @param {object | null} productJson
   * @param {{ name: string, value: string }[]} selections
   * @returns {string | null}
   */
  function matchVariantId(productJson, selections) {
    if (!productJson || !selections?.length || !Array.isArray(productJson.variants)) return null;

    const optionNames = Array.isArray(productJson.options)
      ? productJson.options.map((opt) => (typeof opt === 'string' ? opt : opt?.name || ''))
      : [];

    const wanted = selections
      .map((sel) => {
        const index = optionNames.findIndex((n) => n.toLowerCase() === sel.name.toLowerCase());
        return index >= 0 ? { index, value: sel.value } : null;
      })
      .filter(Boolean);

    if (!wanted.length) return null;

    const variant = productJson.variants.find((v) =>
      wanted.every(({ index, value }) => {
        const candidate = v[`option${index + 1}`] || v.options?.[index] || '';
        return String(candidate) === String(value);
      })
    );

    return variant?.id != null ? String(variant.id) : null;
  }

  /**
   * Sync Size (etc.) without firing change/click (avoids Horizon morph jump).
   * Remaps data-variant-id onto existing option inputs from the new product JSON.
   * @param {string | null} variantId
   * @param {object | null} [product]
   */
  function applyPersistedVariant(variantId, product = null) {
    const picker = document.querySelector('#MainContent variant-picker') || document.querySelector('variant-picker');
    const form =
      picker?.closest('form[action*="/cart/add"]') ||
      document.querySelector('#MainContent form[action*="/cart/add"]');

    // Remap Size radios to the new product's variant ids (same labels, new ids).
    if (picker && product && Array.isArray(product.variants)) {
      product.variants.forEach((variant) => {
        const optionValue = variant.option1 || variant.options?.[0];
        if (optionValue == null) return;
        const value = String(optionValue);
        const input =
          picker.querySelector(`input[type="radio"][value="${CSS.escape(value)}"]`) ||
          picker.querySelector(`[data-value="${CSS.escape(value)}"]`);
        if (!input) return;
        input.setAttribute('data-variant-id', String(variant.id));
        if (input instanceof HTMLElement) input.dataset.variantId = String(variant.id);
      });
    }

    if (!variantId) return;

    const url = new URL(window.location.href);
    url.searchParams.set('variant', variantId);
    history.replaceState(history.state || { mpgSoftNav: true }, document.title, url.toString());

    if (!picker) {
      const idInputOnly = form?.querySelector('input[name="id"]');
      if (idInputOnly instanceof HTMLInputElement) idInputOnly.value = variantId;
      return;
    }

    const input =
      picker.querySelector(`input[data-variant-id="${variantId}"]`) ||
      picker.querySelector(`[data-variant-id="${variantId}"]`);

    if (input instanceof HTMLInputElement) {
      picker.querySelectorAll('input[type="radio"]').forEach((radio) => {
        if (radio instanceof HTMLInputElement) radio.checked = radio === input;
      });
      input.checked = true;
    } else if (input instanceof HTMLElement) {
      input.setAttribute('aria-checked', 'true');
      input.classList.add('selected');
    }

    const idInput = form?.querySelector('input[name="id"]');
    if (idInput instanceof HTMLInputElement) idInput.value = variantId;
  }

  /**
   * Format Shopify money (cents) for display.
   * @param {number} cents
   * @returns {string}
   */
  function formatMoney(cents) {
    const value = Number(cents);
    if (!Number.isFinite(value)) return '';
    try {
      if (typeof window.Shopify?.formatMoney === 'function') {
        const fmt =
          window.theme?.moneyFormat ||
          window.Shopify.money_format ||
          window.Shopify.currency?.active ||
          '${{amount}}';
        if (typeof fmt === 'string' && fmt.includes('{{')) {
          return window.Shopify.formatMoney(value, fmt);
        }
      }
    } catch {
      // ignore
    }
    const currency = window.Shopify?.currency?.active || 'USD';
    try {
      return new Intl.NumberFormat(document.documentElement.lang || 'en', {
        style: 'currency',
        currency,
      }).format(value / 100);
    } catch {
      return `${(value / 100).toFixed(2)}`;
    }
  }

  /**
   * Resolve absolute image URL from product.js media/image fields.
   * @param {string | { src?: string } | null | undefined} image
   * @returns {string}
   */
  function resolveImageUrl(image) {
    if (!image) return '';
    const raw = typeof image === 'string' ? image : image.src || '';
    if (!raw) return '';
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('http')) return raw;
    return raw;
  }

  /**
   * Patch the live PDP from product.js without replacing DOM sections.
   * This avoids CSS reflow / transition jitter from soft-nav HTML swaps.
   * @param {object} product
   * @param {string | null} variantId
   */
  function patchProductInPlace(product, variantId) {
    if (!product) return;
    const main = document.getElementById('MainContent');
    if (!main) return;

    const title = String(product.title || '');
    const variant =
      (variantId && product.variants?.find((item) => String(item.id) === String(variantId))) ||
      product.variants?.[0] ||
      null;
    const priceCents = variant?.price ?? product.price;
    const compareCents = variant?.compare_at_price ?? product.compare_at_price;
    const priceText = formatMoney(priceCents);
    const compareText = compareCents ? formatMoney(compareCents) : '';

    // Document title — keep shop suffix after en-dash / em-dash.
    const prevTitle = document.title || '';
    const suffixMatch = prevTitle.match(/\s+[–—-]\s+(.+)$/);
    document.title = suffixMatch ? `${title} – ${suffixMatch[1]}` : title;

    // Visible product titles (avoid rewriting controls with nested icons).
    main.querySelectorAll('h1, .view-product-title, [data-testid="product-title"]').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest('.mpg-swatch')) return;
      const link = el.querySelector('a');
      const target = link || el;
      if (target.childElementCount > 0 && !link) return;
      target.textContent = title;
    });

    // Price nodes — text only, no component remount.
    if (priceText) {
      main.querySelectorAll('product-price').forEach((priceRoot) => {
        const sale = priceRoot.querySelector('.price, .price-item--sale, [ref="price"], .compare-at-price + .price');
        const regular =
          priceRoot.querySelector('.price-item--regular, .compare-at-price, [ref="compareAtPrice"]') ||
          priceRoot.querySelector('s, .price--compare');
        const primary =
          priceRoot.querySelector('.price__regular .price-item, .price-item--regular, .price-item--sale, .price') ||
          priceRoot;

        if (primary && primary.childElementCount === 0) {
          primary.textContent = priceText;
        } else {
          priceRoot.querySelectorAll('.price-item--sale, .price-item--regular, .price').forEach((node, index) => {
            if (node instanceof HTMLElement && node.childElementCount === 0 && index < 2) {
              if (node.tagName === 'S' || node.classList.contains('compare-at-price')) {
                if (compareText) node.textContent = compareText;
              } else {
                node.textContent = priceText;
              }
            }
          });
        }

        if (regular instanceof HTMLElement && compareText && regular.childElementCount === 0) {
          regular.textContent = compareText;
        }
        if (sale instanceof HTMLElement && sale.childElementCount === 0) {
          sale.textContent = priceText;
        }
      });
    }

    // Featured media — update src only (no gallery remount).
    const imageUrl =
      resolveImageUrl(product.featured_image) ||
      resolveImageUrl(product.images?.[0]) ||
      resolveImageUrl(product.media?.[0]?.preview_image) ||
      resolveImageUrl(product.media?.[0]?.src);
    if (imageUrl) {
      const imgs = main.querySelectorAll(
        'media-gallery img, .product-media-container img, .product-information__media img, .media-gallery__grid img'
      );
      imgs.forEach((img, index) => {
        if (!(img instanceof HTMLImageElement)) return;
        if (index > 0 && !img.closest('[aria-current="true"], .is-selected, .is-active')) return;
        img.src = imageUrl;
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      });
    }

    // Point pickers/forms at the new product/variant without firing morph.
    const productUrl = product.url || `/products/${product.handle}`;
    main.querySelectorAll('variant-picker, product-form-component, product-form').forEach((el) => {
      if (el instanceof HTMLElement) {
        if ('productUrl' in el.dataset || el.hasAttribute('data-product-url')) {
          el.setAttribute('data-product-url', productUrl);
          el.dataset.productUrl = productUrl;
        }
      }
    });

    applyPersistedVariant(variantId || (variant?.id != null ? String(variant.id) : null), product);
  }

  function optimisticallySelect(swatch, clickedOption) {
    if (!swatch || !(clickedOption instanceof Element)) return;

    const optionSet = clickedOption.closest('.mpg-swatch__option-set') || swatch;
    optionSet.querySelectorAll('.mpg-swatch__option.selected, .mpg-swatch__option[aria-checked="true"]').forEach((node) => {
      node.classList.remove('selected');
      if (node instanceof HTMLElement) node.setAttribute('aria-checked', 'false');
    });

    clickedOption.classList.add('selected');
    if (clickedOption instanceof HTMLElement) clickedOption.setAttribute('aria-checked', 'true');

    const labelValue = (clickedOption.closest('.mpg-swatch__option-set') || swatch).querySelector(
      '.mpg-swatch__label-value'
    );
    const optionValue = clickedOption.getAttribute('o-value');
    if (labelValue && optionValue) labelValue.textContent = optionValue;
  }

  function normalizeMpgProduct(product) {
    if (!product) return null;
    const next = { ...product, id: String(product.id) };

    if (Array.isArray(next.variants) && next.variants.length) {
      next.selected_variant_id = String(next.selected_variant_id || next.variants[0].id);
    }

    if (Array.isArray(next.options) && typeof next.options[0] === 'string') {
      next.options = next.options.map((name, index) => ({
        name,
        position: index + 1,
        values: [
          ...new Set(
            (next.variants || [])
              .map((variant) => variant[`option${index + 1}`] || variant.options?.[index])
              .filter(Boolean)
          ),
        ],
      }));
    }

    return next;
  }

  /**
   * Sync mpg.product without forcing a full swatch remount (DOM is preserved).
   * @param {object | null} product
   * @param {string | null} [preferredVariantId]
   */
  function syncMpgProduct(product, preferredVariantId) {
    if (!window.mpg) return;
    const nextProduct = normalizeMpgProduct(product);
    if (!nextProduct) return;

    if (preferredVariantId) {
      nextProduct.selected_variant_id = String(preferredVariantId);
    }

    window.mpg.product = nextProduct;
  }

  /**
   * @param {string} handle
   */
  function updateGroupOptionSelected(handle) {
    const swatch = getSwatchEl();
    if (!swatch || !window.mpg?.group?.products) return;

    const product = window.mpg.group.products.find((item) => sameHandle(item.handle, handle));
    const valueIds = product?.options || [];

    swatch.querySelectorAll('.mpg-swatch__option-set').forEach((set) => {
      let selectedValue = '';
      set.querySelectorAll('.mpg-swatch__option[v-id]').forEach((option) => {
        const valueId = option.getAttribute('v-id');
        const selected = Boolean(valueId && valueIds.includes(valueId));
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-checked', selected ? 'true' : 'false');
        if (selected) selectedValue = option.getAttribute('o-value') || selectedValue;
      });
      const labelValue = set.querySelector('.mpg-swatch__label-value');
      if (labelValue && selectedValue) labelValue.textContent = selectedValue;
    });
  }

  /**
   * Rewrite DOMContentLoaded waits so soft-nav re-exec still initializes widgets.
   * @param {string} code
   * @returns {string}
   */
  function rewriteDomReadyListeners(code) {
    return String(code || '').replace(
      /document\.addEventListener\s*\(\s*(['"])DOMContentLoaded\1\s*,\s*/g,
      '(window.__mpgSoftNav.runWhenDomReady)('
    );
  }

  /**
   * Toggle one FAQ / fold title panel (same behavior as unit.js unfoldArrow).
   * @param {HTMLElement} title
   */
  function toggleUnfoldTitle(title) {
    const panel = title.nextElementSibling;
    if (!(panel instanceof HTMLElement)) return;
    if (!panel.classList.contains('unfold-content') && !panel.classList.contains('faq-item-content') && !panel.classList.contains('fold-item-content')) {
      // Still allow generic sibling panels used by unfold widgets
    }

    if (!title.hasAttribute('index')) title.setAttribute('index', '0');

    const arrow = title.querySelector('svg');
    const opening = title.getAttribute('index') === '0';

    if (opening) {
      // Clear any stale 0 height from a previous product before measuring.
      panel.style.height = 'auto';
      const h = panel.scrollHeight;
      panel.style.height = '0px';
      // Force reflow so the transition from 0 → h animates after soft-nav.
      void panel.offsetHeight;
      panel.style.height = `${h}px`;
      if (arrow) arrow.style.transform = `rotate(${title.getAttribute('data-deg') || '180'}deg)`;
      title.setAttribute('index', '1');
    } else {
      panel.style.height = '0px';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      title.setAttribute('index', '0');
    }
  }

  /**
   * Apply default open state per FAQ/fold block after soft-nav / morph.
   * Skips titles that already have an `index` (avoids re-measuring heights and
   * fighting CSS transitions on every Horizon morph).
   * @param {ParentNode | null} [root]
   * @param {{ force?: boolean }} [options]
   */
  function initUnfoldOpenState(root, options = {}) {
    const { force = false } = options;
    const scope = root || document.getElementById('MainContent') || document;
    if (!(scope instanceof Element) && scope !== document) return;

    const blocks = scope.querySelectorAll('.faq-container, .fold-box');
    /** @type {Array<Element | Document>} */
    const groups = blocks.length ? Array.from(blocks) : [scope];

    groups.forEach((block) => {
      const list = block.querySelectorAll('.faq-item > .unfold-title, .fold-item > .unfold-title');
      const titles = list.length ? list : block.querySelectorAll('.unfold-title');

      titles.forEach((title, i) => {
        if (!(title instanceof HTMLElement)) return;
        // Already initialized — do not rewrite inline heights (causes visible bounce).
        if (!force && title.hasAttribute('index')) return;

        const panel = title.nextElementSibling;
        if (!(panel instanceof HTMLElement)) return;

        const prevTransition = panel.style.transition;
        panel.style.transition = 'none';

        title.setAttribute('index', '0');

        const shouldOpen = i === 0 && title.getAttribute('data-index-open') === 'true';
        if (shouldOpen) {
          panel.style.height = 'auto';
          const h = panel.scrollHeight;
          panel.style.height = `${h}px`;
          const svg = title.querySelector('svg');
          if (svg) svg.style.transform = `rotate(${title.getAttribute('data-deg') || '180'}deg)`;
          title.setAttribute('index', '1');
        } else {
          panel.style.height = '0px';
        }

        // Restore transition on next frame so user clicks still animate.
        requestAnimationFrame(() => {
          panel.style.transition = prevTransition;
        });
      });
    });
  }

  /**
   * Kept for morph.js / external callers. Delegation handles clicks; this only
   * restores default open/closed heights on fresh (uninitialized) DOM nodes.
   * @param {ParentNode | null} [root]
   * @param {{ force?: boolean }} [options]
   */
  function rebindUnfoldTitles(root, options) {
    initUnfoldOpenState(root, options);
  }

  /**
   * Permanent capture-phase delegate so FAQ/fold keep working after soft-nav
   * replaces #MainContent (per-node listeners from unit.js are discarded).
   * Stops the original unfoldArrow bubble handlers to avoid double-toggle.
   */
  function installUnfoldDelegate() {
    if (window.__mpgSoftNav.__unfoldDelegateInstalled) return;
    window.__mpgSoftNav.__unfoldDelegateInstalled = true;

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        // Let real controls inside the title row work (e.g. fold header icon link).
        if (target.closest('a[href], button, input, select, textarea, label')) return;

        const title = target.closest('.unfold-title');
        if (!(title instanceof HTMLElement)) return;
        if (!title.closest('#MainContent, main, .faq-container, .fold-box')) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        toggleUnfoldTitle(title);
      },
      true
    );

    runWhenDomReady(() => {
      // Don't force-measure unfold heights on first paint — unit.js already did.
      // Only bind missing indexes without rewriting open panel heights.
      const main = document.getElementById('MainContent');
      if (!main) return;
      main.querySelectorAll('.unfold-title').forEach((title) => {
        if (title instanceof HTMLElement && !title.hasAttribute('index')) {
          title.setAttribute('index', '0');
        }
      });
    });
  }

  installUnfoldDelegate();

  /**
   * DOMParser + importNode does not run <script>. Soft-nav would otherwise leave
   * inline block/section click handlers dead. Re-create scripts so they run again.
   * @param {Element} container
   */
  function reexecuteInlineScripts(container) {
    if (!(container instanceof Element)) return;

    container.querySelectorAll('script').forEach((oldScript) => {
      if (!(oldScript instanceof HTMLScriptElement)) return;

      const type = (oldScript.getAttribute('type') || '').trim().toLowerCase();
      if (
        type &&
        type !== 'text/javascript' &&
        type !== 'module' &&
        type !== 'application/javascript' &&
        type !== 'application/ecmascript'
      ) {
        return;
      }

      const parent = oldScript.parentNode;
      if (!parent) return;

      const next = document.createElement('script');
      for (const attr of Array.from(oldScript.attributes)) {
        if (attr.name === 'src') continue;
        next.setAttribute(attr.name, attr.value);
      }

      if (oldScript.src) {
        // The gallery initializer is shared; its inline call below owns each new instance.
        if (new URL(oldScript.src, window.location.origin).pathname.endsWith('/custom-media-gallery.js') &&
            typeof window.initCustomMediaGallery === 'function') {
          oldScript.remove();
          return;
        }
        // Preserve Shopify's versioned URL so browser/module caches remain effective.
        next.src = oldScript.src;
      } else if (oldScript.textContent) {
        const raw = oldScript.textContent;
        // faqs.liquid / fold.liquid bind via unfoldArrow — clicks are handled by
        // installUnfoldDelegate. Drop these modules to avoid racing / double work.
        if (/\bunfoldArrow\s*\(/.test(raw) || /\bunfoldAdd\s*\(/.test(raw)) {
          oldScript.remove();
          return;
        }
        next.textContent = rewriteDomReadyListeners(raw);
      }

      oldScript.remove();
      parent.appendChild(next);
    });
  }

  /**
   * @param {Element} container
   */
  function refreshThemeComponents(container) {
    if (!(container instanceof Element)) return;

    // Avoid walking every node — full-tree updatedCallback causes layout thrash.
    const selectors = [
      'variant-picker',
      'product-form-component',
      'product-price',
      'media-gallery',
      'product-media-gallery',
      'quantity-selector-component',
      'sticky-add-to-cart',
    ];
    container.querySelectorAll(selectors.join(',')).forEach((node) => {
      if (typeof node.updatedCallback === 'function') {
        try {
          node.updatedCallback();
        } catch {
          // ignore
        }
      }
    });
  }

  /**
   * Soft-nav replaces #MainContent via importNode. Re-bind inline scripts,
   * refresh Horizon components, and nudge third-party widgets.
   * @param {{ scripts?: boolean, sections?: boolean, judgeme?: boolean, unfold?: boolean, root?: Element }} [options]
   */
  function reinitAfterSoftNav(options = {}) {
    const { scripts = true, sections = false, judgeme = false, unfold = false } = options;
    const main = options.root || document.getElementById('MainContent');
    if (!main) return;

    try {
      if (scripts) reexecuteInlineScripts(main);
      refreshThemeComponents(main);

      // FAQ/fold are preserved across soft-nav; only init if fresh nodes appear.
      if (unfold) rebindUnfoldTitles(main, { force: false });

      if (judgeme && window.jdgm) {
        main.querySelectorAll('.jdgm-preview-badge').forEach((el) => {
          el.classList.remove('jdgm--done-setup', 'jdgm--done-setup-widget');
        });
        if (typeof window.jdgm.customizeBadges === 'function') window.jdgm.customizeBadges();
      }

      if (sections) {
        main.querySelectorAll('.shopify-section').forEach((section) => {
          section.dispatchEvent(
            new CustomEvent('shopify:section:load', {
              bubbles: true,
              detail: { sectionId: section.id?.replace(/^shopify-section-/, '') },
            })
          );
        });
      }

      document.dispatchEvent(
        new CustomEvent('mpg:soft-nav:done', {
          bubbles: true,
          detail: { pathname: window.location.pathname },
        })
      );
    } catch (error) {
      console.warn('[combined-listings-persist] soft-nav reinit failed', error);
    }
  }

  function reinitThirdPartyWidgets() {
    reinitAfterSoftNav({ scripts: true });
  }

  function clearNavLock() {
    window.clearTimeout(secondaryRefreshTimer);
    navigationId++;
    activeController?.abort();
    activeController = null;
    navigating = false;
    setNavigationBusy(false);
    document.documentElement.classList.remove(NAV_CLASS);
  }

  /** Offer an explicit retry without replacing a working product with an error document. */
  function showNavigationError(handle, clickedOption) {
    document.getElementById('mpg-navigation-error')?.remove();
    const swatch = getSwatchEl();
    const messages = document.getElementById('mpg-navigation-script')?.dataset;
    if (!swatch || !messages?.loadError || !messages.retryLabel) return;
    const notice = document.createElement('div');
    notice.id = 'mpg-navigation-error';
    notice.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.textContent = messages.loadError;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button-secondary';
    retry.textContent = messages.retryLabel;
    retry.addEventListener('click', () => softNavigate(handle, clickedOption));
    notice.append(message, retry);
    swatch.after(notice);
  }

  /** Commit the server-rendered purchase region without rebuilding the rest of the page. */
  async function swapProductSection(result, handle, clickedOption, options, requestId) {
    const { morphSection } = await import('@theme/section-renderer');
    if (requestId !== navigationId) return;
    const { doc, sectionId, product, variantId, finalUrl } = result;
    const oldSection = document.getElementById(`shopify-section-${sectionId}`);
    const sourceSection = doc.getElementById(`shopify-section-${sectionId}`);
    if (!oldSection || !sourceSection) throw new Error('Product section missing');
    const nextSection = document.importNode(sourceSection, true);
    const stylesheet = doc.querySelector('style[data-section-stylesheet]');
    if (stylesheet && !nextSection.querySelector('style[data-section-stylesheet]')) {
      nextSection.prepend(stylesheet.cloneNode(true));
    }
    const swatch = getSwatchEl();
    const focused = swatch?.contains(document.activeElement) ? document.activeElement : null;
    let oldAnchor;
    const anchorId = `mpg-swatch-anchor-${sectionId}`;
    if (swatch && oldSection.contains(swatch)) {
      const anchor = document.createElement('span');
      anchor.id = anchorId;
      const replacement = nextSection.querySelector('.mpg-swatch:not(.mpg-card)');
      const target = findThroneTarget(nextSection);
      if (!replacement && !target) throw new Error('Product swatch target missing');
      if (replacement) replacement.replaceWith(anchor);
      else target.before(anchor);
      oldAnchor = document.createElement('span');
      oldAnchor.id = anchorId;
      swatch.replaceWith(oldAnchor);
    }
    try {
      await morphSection(sectionId, nextSection.outerHTML);
    } finally {
      const anchor = document.getElementById(anchorId) || (oldAnchor?.isConnected ? oldAnchor : null);
      if (anchor && swatch) anchor.replaceWith(swatch);
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    }
    if (requestId !== navigationId) return;
    syncMpgProduct(product, variantId);
    optimisticallySelect(swatch, clickedOption);
    updateGroupOptionSelected(handle);
    const suffix = document.title.match(/\s+[–—-]\s+(.+)$/)?.[1];
    document.title = suffix ? `${product.title} – ${suffix}` : product.title;
    const state = { ...history.state, mpgSoftNav: true };
    if (options.skipHistory) history.replaceState(state, document.title, finalUrl.toString());
    else history.pushState(state, document.title, finalUrl.toString());
    renderedUrl = finalUrl.toString();
    hookMpg(true);
    reinitAfterSoftNav({ root: oldSection, scripts: true, judgeme: true, unfold: true });
    // Product-dependent content below the purchase region follows after the visible switch.
    secondaryRefreshTimer = window.setTimeout(() => refreshOtherSections(result, requestId), 500);
  }

  async function refreshOtherSections(result, requestId) {
    if (requestId !== navigationId) return;
    try {
      const doc = await cachedResponse(result.finalUrl.toString(), 'html', 'low', result.product.id);
      const { morphSection } = await import('@theme/section-renderer');
      for (const section of doc.querySelectorAll('#MainContent > .shopify-section')) {
        if (requestId !== navigationId || window.location.href !== result.finalUrl.toString()) return;
        const id = section.id.replace(/^shopify-section-/, '');
        if (id === result.sectionId || !document.getElementById(section.id)) continue;
        await morphSection(id, section.outerHTML);
        reinitAfterSoftNav({ root: document.getElementById(section.id), scripts: true, unfold: true });
      }
    } catch (error) {
      // A below-fold refresh must never undo a successful product selection.
      if (requestId === navigationId) console.warn('[combined-listings] secondary content refresh failed', error);
    }
  }

  /**
   * Swap #MainContent from fetched HTML while keeping the live Combined Listings
   * swatch node in the document (so that region barely "refreshes").
   * @param {Document} doc - Cached server-rendered document, cloned before insertion.
   * @param {string} handle
   * @param {Element | null} clickedOption
   * @param {object | null} productJson
   * @param {string | null} persistedVariantId
   * @param {URL} finalUrl
   * @param {object} options
   */
  function swapMainPreservingSwatch(doc, handle, clickedOption, productJson, persistedVariantId, finalUrl, options) {
    const newMain = doc.getElementById('MainContent');
    const oldMain = document.getElementById('MainContent');
    if (!newMain || !oldMain) throw new Error('MainContent missing');

    const liveSwatch = getSwatchEl();
    const focusedOption = liveSwatch?.contains(document.activeElement) ? document.activeElement : null;
    const importedMain = document.importNode(newMain, true);
    const importedSwatch = importedMain.querySelector('.mpg-swatch:not(.mpg-card)');

    if (liveSwatch instanceof HTMLElement && importedSwatch) {
      liveSwatch.style.viewTransitionName = 'mpg-combined-listings';
      importedSwatch.replaceWith(liveSwatch);
      if (clickedOption instanceof Element && liveSwatch.contains(clickedOption)) {
        optimisticallySelect(liveSwatch, clickedOption);
      }
      updateGroupOptionSelected(handle);
    }

    if (!options.skipHistory) {
      history.pushState(
        { mpgSoftNav: true },
        doc.title || document.title,
        finalUrl.toString()
      );
    } else {
      history.replaceState(
        { mpgSoftNav: true },
        doc.title || document.title,
        finalUrl.toString()
      );
    }

    if (doc.title) document.title = doc.title;
    oldMain.replaceWith(importedMain);
    renderedUrl = finalUrl.toString();
    if (focusedOption instanceof HTMLElement) focusedOption.focus({ preventScroll: true });

    if (productJson) {
      syncMpgProduct(productJson, persistedVariantId);
    }
    hookMpg(true);
    reinitAfterSoftNav({ scripts: true, judgeme: true, unfold: true });
  }

  /**
   * @param {string} productHandle
   * @param {Element | null} clickedOption
   * @param {object} [options]
   */
  async function softNavigate(productHandle, clickedOption, options = {}) {
    if (!productHandle) return;

    const handle = safeDecode(productHandle);
    const url = buildProductUrl(handle);
    document.getElementById('mpg-navigation-error')?.remove();

    if (sameProductPath(url.pathname, window.location.pathname) && !options.force) {
      clearNavLock();
      optimisticallySelect(getSwatchEl(), clickedOption);
      updateGroupOptionSelected(handle);
      return;
    }

    // Emergency hard navigation only when explicitly forced.
    if (HARD_NAV_ONLY || window.__mpgForceHardNav) {
      const swatch = getSwatchEl();
      optimisticallySelect(swatch, clickedOption);
      if (swatch instanceof HTMLElement) {
        swatch.style.viewTransitionName = 'mpg-combined-listings';
      }
      window.location.assign(url.toString());
      return;
    }

    const themeSelections = captureThemeOptionSelections();
    const requestId = ++navigationId;
    window.clearTimeout(secondaryRefreshTimer);
    const startedAt = performance.now();
    navigating = true;

    try {
      activeController?.abort();
    } catch {
      // ignore
    }
    activeController = new AbortController();
    const { signal } = activeController;
    setNavigationBusy(true);

    const swatch = getSwatchEl();
    optimisticallySelect(swatch, clickedOption);
    if (swatch instanceof HTMLElement) {
      swatch.style.viewTransitionName = 'mpg-combined-listings';
    }

    try {
      const preferredVariantId = options.skipHistory ? new URL(window.location.href).searchParams.get('variant') : null;
      const result = await waitForResponse(
        loadProduct(handle, themeSelections, 'high', preferredVariantId), signal
      );
      if (signal.aborted || requestId !== navigationId) return;

      // Commit immediately. A view-transition snapshot/animation must not queue another click.
      if (result.sectionId) {
        await swapProductSection(result, handle, clickedOption, options, requestId);
      } else {
        swapMainPreservingSwatch(result.doc, handle, clickedOption, result.product, result.variantId, result.finalUrl, options);
      }
      if (requestId !== navigationId) return;
      window.__mpgSoftNav.lastNavigation = {
        handle,
        durationMs: Math.round(performance.now() - startedAt),
        // DOM-ready timing; image downloads/paint must also be checked in the browser.
      };
    } catch (error) {
      if (signal.aborted || requestId !== navigationId) return;

      console.warn('[combined-listings-hardnav] product switch failed; current product retained', error);
      clearNavLock();
      // popstate changes the address before the request: restore the product still on screen.
      if (window.location.href !== renderedUrl) history.replaceState(history.state, document.title, renderedUrl);
      const currentHandle = new URL(renderedUrl).pathname.split('/products/')[1]?.split('/')[0];
      if (currentHandle) updateGroupOptionSelected(safeDecode(currentHandle));
      prefetchPausedUntil = Math.max(prefetchPausedUntil, Date.now() + 30000);
      prefetchQueue = [];
      showNavigationError(handle, clickedOption);
      return;
    } finally {
      if (requestId === navigationId) {
        navigating = false;
        activeController = null;
        setNavigationBusy(false);
        document.documentElement.classList.remove(NAV_CLASS);
        schedulePrefetch();
        pumpPrefetch();
      }
    }
  }

  function hookMpg(force) {
    window.mpg = window.mpg || {};
    window.mpg.setupPlaceholderSwatch = false;

    if (typeof window.mpg.redirectToProductPage !== 'function') return false;
    if (window.mpg.__themeSoftNavHooked && !force) {
      if (window.mpg.redirectToProductPage.__themeSoftNav === true) return true;
    }

    if (!window.mpg.__themeSoftNavOriginal) {
      window.mpg.__themeSoftNavOriginal = window.mpg.redirectToProductPage;
    }

    const wrapped = function (productHandle, clickedOption) {
      const option = clickedOption instanceof Element ? clickedOption : null;
      // Prefer combination-aware resolve; fall back to plugin-provided handle.
      const resolved = (option && resolveHandleFromOption(option)) || safeDecode(productHandle);
      softNavigate(resolved, option);
    };
    wrapped.__themeSoftNav = true;
    window.mpg.redirectToProductPage = wrapped;
    window.mpg.__themeSoftNavHooked = true;
    schedulePrefetch();
    return true;
  }

  window.addEventListener('popstate', () => {
    if (!isProductPage()) return;
    const parts = window.location.pathname.split('/').filter(Boolean);
    const productsIdx = parts.indexOf('products');
    const handle = productsIdx >= 0 ? parts[productsIdx + 1] : null;
    if (!handle) return;
    softNavigate(safeDecode(handle), null, { skipHistory: true, force: true });
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!isProductPage()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const option = target.closest(
        '.mpg-swatch:not(.mpg-card) [onclick*="redirectToProductPage"], .mpg-swatch:not(.mpg-card) .mpg-swatch__option[v-id]'
      );
      if (!option) return;

      // Ignore blocked / unavailable options from Grouptify
      if (option.classList.contains('blocked') || option.getAttribute('aria-disabled') === 'true') {
        return;
      }

      const handle = resolveHandleFromOption(option);
      if (!handle) return;

      const now = Date.now();
      const prev = Number(option.getAttribute(HANDLED_ATTR) || 0);
      if (now - prev < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      option.setAttribute(HANDLED_ATTR, String(now));

      event.preventDefault();
      event.stopPropagation();
      softNavigate(handle, option);
    },
    true
  );

  window.addEventListener('pagehide', clearNavLock);
  window.addEventListener('load', schedulePrefetch, { once: true });
  window.addEventListener('pageshow', schedulePrefetch);
  document.addEventListener('pointerover', prefetchOption, { passive: true });
  document.addEventListener('focusin', prefetchOption);
  document.addEventListener('touchstart', prefetchOption, { passive: true });
  document.addEventListener('variant:update', () => {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(schedulePrefetch, 200);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !activeController) clearNavLock();
  });

  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    hookMpg(tries % 25 === 0);
    if (tries > 300) window.clearInterval(timer);
  }, 200);

  Object.assign(window.__mpgSoftNav, {
    /** Upload check: __mpgSoftNav.build === "20261019a" */
    build: '20261019a',
    hardNav: HARD_NAV_ONLY,
    asset: 'combined-listings-hardnav.js',
    preserveSwatch: true,
    softNavigate,
    clearNavLock,
    reinitAfterSoftNav,
    reinitThirdPartyWidgets,
    resolveHandleFromOption,
    getDesiredValueIds,
    rebindUnfoldTitles,
    initUnfoldOpenState,
    toggleUnfoldTitle,
    patchProductInPlace,
    runWhenDomReady,
    get navigating() {
      return navigating;
    },
  });

  // Horizon morph (variant / combined listing) can replace FAQ/fold nodes without
  // re-running their module binders — re-bind on morph completion.
  document.addEventListener('theme:morph:done', (event) => {
    const detail = /** @type {CustomEvent} */ (event).detail;
    const root =
      detail?.container instanceof Element || detail?.container === document
        ? detail.container
        : document.getElementById('MainContent');
    rebindUnfoldTitles(root);
  });
})();
