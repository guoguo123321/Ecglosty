import { Component } from '@theme/component';
import { VariantSelectedEvent, VariantUpdateEvent } from '@theme/events';
import { morph, MORPH_OPTIONS } from '@theme/morph';
import { OverflowList } from '@theme/overflow-list';
import { yieldToMainThread, getViewParameterValue, ResizeNotifier } from '@theme/utilities';

// Keep response text immutable: variant event consumers move nodes out of parsed documents.
const variantResponseCache = new Map();
function getVariantResponse(requestUrl, priority = 'high') {
  const normalizedUrl = new URL(requestUrl, window.location.origin);
  normalizedUrl.searchParams.sort();
  const key = `${window.Shopify?.currency?.active || ''}:${normalizedUrl}`;
  const cached = variantResponseCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const entry = { expires: Infinity, promise: null };
  entry.promise = fetch(requestUrl, { signal: controller.signal, priority })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Variant request failed: ${response.status}`);
      const text = await response.text();
      if (!new DOMParser().parseFromString(text, 'text/html').querySelector('variant-picker script[type="application/json"]')) {
        throw new Error('Variant response missing');
      }
      entry.expires = Date.now() + 30000;
      return text;
    })
    .catch((error) => {
      if (variantResponseCache.get(key) === entry) variantResponseCache.delete(key);
      throw error;
    })
    .finally(() => clearTimeout(timeout));
  variantResponseCache.set(key, entry);
  while (variantResponseCache.size > 24) variantResponseCache.delete(variantResponseCache.keys().next().value);
  return entry.promise;
}

/**
 * @typedef {object} VariantPickerRefs
 * @property {HTMLFieldSetElement[]} fieldsets - The fieldset elements.
 * @property {HTMLElement} [overflowList] - The overflow list element.
 */

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [TRefs=VariantPickerRefs]
 * @extends Component<TRefs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;
  #listenerController;
  #prefetching = false;

  /** @type {number[][]} */
  #checkedIndices = [];

  /** @type {HTMLInputElement[][]} */
  #radios = [];

  #resizeObserver = new ResizeNotifier(() => this.updateVariantPickerCss());

  connectedCallback() {
    super.connectedCallback();
    this.#initializeFieldsets();
    this.#listenerController?.abort();
    this.#listenerController = new AbortController();
    const { signal } = this.#listenerController;
    this.addEventListener('change', this.variantChanged.bind(this), { signal });
    this.addEventListener('pointerover', this.#prefetchVariant, { signal, passive: true });
    this.addEventListener('focusin', this.#prefetchVariant, { signal });
    this.addEventListener('touchstart', this.#prefetchVariant, { signal, passive: true });
    this.#resizeObserver.observe(this);
  }

  updatedCallback() {
    super.updatedCallback();
    this.#initializeFieldsets();
  }

  #initializeFieldsets() {
    this.#radios = [];
    this.#checkedIndices = [];
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    fieldsets.forEach((fieldset) => {
      const radios = Array.from(fieldset?.querySelectorAll('input') ?? []);
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      this.#checkedIndices.push(initialCheckedIndex === -1 ? [] : [initialCheckedIndex]);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
    this.#listenerController?.abort();
    this.#resizeObserver.disconnect();
  }

  /** @param {Event} event */
  #prefetchVariant = (event) => {
    if (this.#prefetching || navigator.connection?.saveData || /^(slow-)?2g$/.test(navigator.connection?.effectiveType || '')) return;
    if (!(event.target instanceof Element)) return;
    const input = event.target.closest('label')?.querySelector('input[type="radio"]') || event.target;
    if (!(input instanceof HTMLInputElement) || input.checked) return;
    if (input.dataset.connectedProductUrl && input.dataset.connectedProductUrl !== this.dataset.productUrl) return;
    const checked = input.closest('fieldset')?.querySelector('input:checked');
    if (!(checked instanceof HTMLInputElement) || !input.dataset.optionValueId) return;
    const url = new URL(this.buildRequestUrl(input), window.location.origin);
    if (!url.searchParams.has('variant')) {
      url.searchParams.set('option_values', this.selectedOptionsValues
        .map((value) => value === checked.dataset.optionValueId ? input.dataset.optionValueId : value).join(','));
    }
    this.#prefetching = true;
    getVariantResponse(`${url.pathname}${url.search}`, 'low').catch(() => {}).finally(() => { this.#prefetching = false; });
  };

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(new VariantSelectedEvent({
      id: selectedOption.dataset.optionValueId ?? '',
    }));

    const isOnProductPage =
      this.dataset.templateProductMatch === 'true' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;
    const isOnFeaturedProductSection = Boolean(this.closest('featured-product-information'));

    const morphElementSelector = loadsNewProduct
      ? 'main'
      : isOnFeaturedProductSection
      ? 'featured-product-information'
      : undefined;

    const requestUrl = this.buildRequestUrl(selectedOption);
    if (!morphElementSelector && isOnProductPage) this.#applyLocalVariant(requestUrl);
    this.fetchUpdatedSection(requestUrl, morphElementSelector);

    const url = new URL(window.location.href);

    const variantId = new URL(requestUrl, window.location.origin).searchParams.get('variant') || selectedOption.dataset.variantId || null;

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set('variant', variantId);
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      yieldToMainThread().then(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * Immediately apply a simple variant using Liquid-formatted prices already on the page.
   * Complex availability, media, quantity, subscription and inventory changes use server HTML.
   * The normal section request still reconciles the result with the server.
   * @param {string} requestUrl
   * @returns {boolean}
   */
  #applyLocalVariant(requestUrl) {
    const section = this.closest('.shopify-section');
    const stateText = section?.querySelector('script[data-product-switch-state]')?.textContent;
    const variantScript = this.querySelector('script[type="application/json"]');
    const id = new URL(requestUrl, window.location.origin).searchParams.get('variant');
    if (!section || !stateText || !variantScript?.textContent || !id) return false;
    try {
      const product = JSON.parse(stateText);
      const previous = JSON.parse(variantScript.textContent);
      const variant = product.variants.find((variant) => String(variant.id) === id);
      if (String(product.id) !== this.dataset.productId || !variant?.available || !previous?.available ||
          product.requires_selling_plan || product.has_volume_pricing ||
          !product.variants.every((variant) => variant.available) || variant.unit_price || previous.unit_price ||
          !variant.formatted_price || typeof variant.formatted_compare_at_price !== 'string' ||
          JSON.stringify(variant.quantity_rule) !== JSON.stringify(previous.quantity_rule) ||
          (variant.featured_media_id || null) !== (previous.featured_media?.id || null) ||
          section.querySelector('product-inventory, local-pickup, volume-pricing, price-per-item, .quantity-rules')) return false;
      const resource = {
        ...previous, ...variant,
        option1: variant.options[0], option2: variant.options[1] || null, option3: variant.options[2] || null,
        public_title: variant.title, name: `${product.title} - ${variant.title}`,
      };
      const html = new DOMParser().parseFromString(section.outerHTML, 'text/html');
      const sale = Number(variant.compare_at_price) > Number(variant.price);
      for (const root of html.querySelectorAll('product-price, sticky-add-to-cart')) {
        for (const price of root.querySelectorAll('.price')) price.innerHTML = variant.formatted_price;
        for (const price of root.querySelectorAll('.compare-at-price')) price.innerHTML = variant.formatted_compare_at_price;
        root.querySelector('.price__regular')?.classList.toggle('price__hidden', sale);
        root.querySelector('.price__sale')?.classList.toggle('price__hidden', !sale);
      }
      variantScript.textContent = JSON.stringify(resource);
      this.dispatchEvent(new VariantUpdateEvent(resource, this.selectedOptionId || '', {
        html, productId: this.dataset.productId || '',
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @typedef {object} FieldsetMeasurements
   * @property {HTMLFieldSetElement} fieldset
   * @property {number | undefined} currentIndex
   * @property {number | undefined} previousIndex
   * @property {number | undefined} currentWidth
   * @property {number | undefined} previousWidth
   */

  /**
   * Gets measurements for a single fieldset (read phase).
   * @param {number} fieldsetIndex
   * @returns {FieldsetMeasurements | null}
   */
  #getFieldsetMeasurements(fieldsetIndex) {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
    const fieldset = fieldsets[fieldsetIndex];
    const checkedIndices = this.#checkedIndices[fieldsetIndex];
    const radios = this.#radios[fieldsetIndex];

    if (!radios || !checkedIndices || !fieldset) return null;

    const [currentIndex, previousIndex] = checkedIndices;

    return {
      fieldset,
      currentIndex,
      previousIndex,
      currentWidth: currentIndex !== undefined ? radios[currentIndex]?.parentElement?.offsetWidth : undefined,
      previousWidth: previousIndex !== undefined ? radios[previousIndex]?.parentElement?.offsetWidth : undefined,
    };
  }

  /**
   * Applies measurements to a fieldset (write phase).
   * @param {FieldsetMeasurements} measurements
   */
  #applyFieldsetMeasurements({ fieldset, currentWidth, previousWidth, currentIndex, previousIndex }) {
    if (currentWidth) {
      fieldset.style.setProperty('--pill-width-current', `${currentWidth}px`);
    } else if (currentIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-current');
    }

    if (previousWidth) {
      fieldset.style.setProperty('--pill-width-previous', `${previousWidth}px`);
    } else if (previousIndex !== undefined) {
      fieldset.style.removeProperty('--pill-width-previous');
    }
  }

  /**
   * Updates the fieldset CSS.
   * @param {number} fieldsetIndex - The fieldset index.
   */
  updateFieldsetCss(fieldsetIndex) {
    if (Number.isNaN(fieldsetIndex)) return;

    const measurements = this.#getFieldsetMeasurements(fieldsetIndex);
    if (measurements) {
      this.#applyFieldsetMeasurements(measurements);
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      const fieldsetIndex = Number.parseInt(target.dataset.fieldsetIndex || '');
      const inputIndex = Number.parseInt(target.dataset.inputIndex || '');

      if (!Number.isNaN(fieldsetIndex) && !Number.isNaN(inputIndex)) {
        const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
        const fieldset = fieldsets[fieldsetIndex];
        const checkedIndices = this.#checkedIndices[fieldsetIndex];
        const radios = this.#radios[fieldsetIndex];

        if (radios && checkedIndices && fieldset) {
          // Clear previous checked states
          const [currentIndex, previousIndex] = checkedIndices;

          if (currentIndex !== undefined && radios[currentIndex]) {
            radios[currentIndex].dataset.previousChecked = 'false';
          }
          if (previousIndex !== undefined && radios[previousIndex]) {
            radios[previousIndex].dataset.previousChecked = 'false';
          }

          // Update checked indices array - keep only the last 2 selections
          checkedIndices.unshift(inputIndex);
          checkedIndices.length = Math.min(checkedIndices.length, 2);

          // Update the new states
          const newCurrentIndex = checkedIndices[0]; // This is always inputIndex
          const newPreviousIndex = checkedIndices[1]; // This might be undefined

          // newCurrentIndex is guaranteed to exist since we just added it
          if (newCurrentIndex !== undefined && radios[newCurrentIndex]) {
            radios[newCurrentIndex].dataset.currentChecked = 'true';
          }

          if (newPreviousIndex !== undefined && radios[newPreviousIndex]) {
            radios[newPreviousIndex].dataset.previousChecked = 'true';
            radios[newPreviousIndex].dataset.currentChecked = 'false';
          }

          this.updateFieldsetCss(fieldsetIndex);
        }
      }
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];
    const viewParamValue = getViewParameterValue();

    // preserve view parameter, if it exists, for alternative product view testing
    if (viewParamValue) params.push(`view=${viewParamValue}`);

    const sameProduct = !selectedOption.dataset.connectedProductUrl || selectedOption.dataset.connectedProductUrl === this.dataset.productUrl;
    let exactVariant;
    if (!source && sameProduct) {
      const text = this.closest('.shopify-section')?.querySelector('script[data-product-switch-state]')?.textContent;
      if (text) {
        try {
          const product = JSON.parse(text);
          const fields = Array.from(this.querySelectorAll('fieldset.variant-option, .variant-option--dropdowns'));
          const values = fields.map((field) => {
            if (field.contains(selectedOption)) return selectedOption instanceof HTMLOptionElement ? selectedOption.value : selectedOption.getAttribute('value');
            return field.querySelector('input:checked')?.getAttribute('value') || field.querySelector('select')?.value;
          });
          if (String(product.id) === this.dataset.productId && values.length === product.options.length) {
            exactVariant = product.variants.find((variant) => variant.options.every((value, index) => value === values[index]));
          }
        } catch {
          // Keep Shopify's option_values resolver for unavailable or unsupported combinations.
        }
      }
    }
    if (exactVariant) {
      params.push(`variant=${exactVariant.id}`);
    } else if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of some specific sections, we need to append section_id=xxxx to the URL
    const SECTION_ID_MAP = {
      'quick-add-component': 'section-rendering-product-card',
      'swatches-variant-picker-component': 'section-rendering-product-card',
      'featured-product-information': this.closest('featured-product-information')?.id,
    };

    const closestSectionId = /** @type {keyof typeof SECTION_ID_MAP} | undefined */ (
      Object.keys(SECTION_ID_MAP).find((sectionId) => this.closest(sectionId))
    );

    if (closestSectionId) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=${SECTION_ID_MAP[closestSectionId]}&${params.join('&')}`;
    }

    const section = this.closest('.shopify-section');
    if (this.dataset.templateProductMatch === 'true' && sameProduct && section?.id && !this.closest('product-card, quick-add-dialog')) {
      params.push(`section_id=${encodeURIComponent(section.id.replace(/^shopify-section-/, ''))}`);
    }
    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {string} [morphElementSelector] - The selector of the element to be morphed. By default, only the variant picker is morphed.
   */
  fetchUpdatedSection(requestUrl, morphElementSelector) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const controller = this.#abortController;
    const productId = this.dataset.productId;

    getVariantResponse(requestUrl)
      .then((responseText) => {
        if (controller.signal.aborted || !this.isConnected || productId !== this.dataset.productId) return;
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        const textContent = html.querySelector(`variant-picker script[type="application/json"]`)?.textContent;
        if (!textContent) return;

        let newProduct;

        if (morphElementSelector === 'main') {
          this.updateMain(html);
        } else if (morphElementSelector) {
          this.updateElement(html, morphElementSelector);
        } else {
          const { overflowList } = this.refs;
          const wasSwatchesExpanded =
            overflowList instanceof OverflowList && overflowList.getAttribute('disabled') === 'true';

          newProduct = this.updateVariantPicker(html);

          if (wasSwatchesExpanded) {
            const overflowListAfterMorph = overflowList;
            if (overflowListAfterMorph instanceof OverflowList) {
              overflowListAfterMorph.showAll();
            }
          }
        }

        // Dispatch for all paths so product-form-component can reset #variantChangeInProgress
        if (this.selectedOptionId) {
          this.dispatchEvent(
            new VariantUpdateEvent(JSON.parse(textContent), this.selectedOptionId, {
              html,
              productId: this.dataset.productId ?? '',
              newProduct,
            })
          );
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          console.warn('Fetch aborted by user');
        } else {
          console.error(error);
        }
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document | Element} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error('No new variant picker source found');
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource, {
      ...MORPH_OPTIONS,
      getNodeKey: (node) => {
        if (!(node instanceof HTMLElement)) return undefined;
        const key = node.dataset.key;
        return key;
      },
    });
    this.updatedCallback();
    this.updateVariantPickerCss();

    return newProduct;
  }

  updateVariantPickerCss() {
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    // Batch all reads first across all fieldsets to avoid layout thrashing
    const measurements = fieldsets.map((_, index) => this.#getFieldsetMeasurements(index)).filter((m) => m !== null);

    // Batch all writes after all reads
    for (const measurement of measurements) {
      this.#applyFieldsetMeasurements(measurement);
    }
  }

  /**
   * Re-renders the desired element.
   * @param {Document} newHtml - The new HTML.
   * @param {string} elementSelector - The selector of the element to re-render.
   */
  updateElement(newHtml, elementSelector) {
    const element = this.closest(elementSelector);
    const newElement = newHtml.querySelector(elementSelector);

    if (!element || !newElement) {
      throw new Error(`No new element source found for ${elementSelector}`);
    }

    morph(element, newElement);
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * Prefer visible option controls so a CSS-hidden color fieldset does not
   * steal selectedOptionId (which would look like "always first color").
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption =
      this.querySelector('fieldset:not(.variant-option--color-hidden) input:checked') ||
      this.querySelector('select.variant-option__select option[selected]') ||
      this.querySelector('select option[selected]') ||
      this.querySelector('fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * Includes hidden color radios so option_values keeps the current color
   * instead of falling back to the first color variant at checkout.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(
      this.querySelectorAll(
        'select option[selected], fieldset.variant-option--color-hidden input:checked, fieldset input:checked'
      )
    );

    // Deduplicate in case the color input matches both color-hidden and generic selectors
    const seen = new Set();
    /** @type {string[]} */
    const values = [];

    for (const option of selectedOptions) {
      const { optionValueId } = option.dataset;
      if (!optionValueId) throw new Error('No option value ID found');
      if (seen.has(optionValueId)) continue;
      seen.add(optionValueId);
      values.push(optionValueId);
    }

    return values;
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
