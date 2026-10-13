import { OverflowList } from '@theme/overflow-list';
import VariantPicker from '@theme/variant-picker';
import { Component } from '@theme/component';
import { debounce, isDesktopBreakpoint, mediaQueryLarge, yieldToMainThread } from '@theme/utilities';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent, SlideshowSelectEvent } from '@theme/events';
import { morph } from '@theme/morph';

/**
 * Keeps `/collections/{handle}/products/{product}` when browsing from a collection page.
 * @param {string} urlString
 * @param {string | undefined} collectionHandle
 * @returns {string}
 */
function withCollectionContext(urlString, collectionHandle) {
  if (!collectionHandle || !urlString) return urlString;

  try {
    const url = new URL(urlString, window.location.origin);
    const productHandleMatch = url.pathname.match(/\/products\/([^/]+)/);

    if (!productHandleMatch) return urlString;

    const productHandle = productHandleMatch[1];
    const pathParts = url.pathname.split('/').filter(Boolean);
    let localePrefix = '';

    if (pathParts.length > 0 && pathParts[0] !== 'collections' && pathParts[0] !== 'products') {
      const looksLikeLocale = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(pathParts[0]);

      if (looksLikeLocale) {
        localePrefix = `/${pathParts[0]}`;
      }
    }

    url.pathname = `${localePrefix}/collections/${collectionHandle}/products/${productHandle}`;
    return url.toString();
  } catch {
    return urlString;
  }
}

/**
 * @typedef {object} ProductCardLinkRefs
 * @property {HTMLElement} [cardGallery] - The card gallery element.
 * @property {HTMLImageElement[]} [imagesToTransition] - The images to transition.
 */

/**
 * A custom element for product links with images for transitions to PDP.
 * This is a base class that is extended by ProductCard.
 * Used directly by resource-card.liquid for non-product-card scenarios.
 *
 * @template {ProductCardLinkRefs} [T=ProductCardLinkRefs]
 * @extends {Component<T>}
 */
export class ProductCardLink extends Component {
  get productTransitionEnabled() {
    return this.getAttribute('data-product-transition') === 'true';
  }

  get featuredMediaUrl() {
    return this.getAttribute('data-featured-media-url');
  }

  /**
   * Handles the click event for view transitions.
   * @param {Event} event
   */
  handleViewTransition(event) {
    // If the event has been prevented, don't do anything, another component is handling the click
    if (event.defaultPrevented) return;

    // If the event was on an interactive element, don't do anything, this is not a navigation
    if (event.target instanceof Element) {
      const interactiveElement = event.target.closest('button, input, label, select, [tabindex="1"]');
      if (interactiveElement) return;
    }

    if (!this.productTransitionEnabled) return;

    const { cardGallery } = this.refs;
    if (!cardGallery || !cardGallery.hasAttribute('data-view-transition-to-main-product')) return;

    // Check on the current active image, whether it's a product card image or a resource card image
    const { imagesToTransition } = this.refs;
    const activeImage =
      imagesToTransition?.find(
        (/** @type {HTMLImageElement} */ image) =>
          image.closest('slideshow-slide')?.getAttribute('aria-hidden') === 'false'
      ) || imagesToTransition?.[imagesToTransition.length - 1];

    if (activeImage instanceof HTMLImageElement) this.#setImageSrcset(activeImage);

    cardGallery.setAttribute('data-view-transition-type', 'product-image-transition');
    cardGallery.setAttribute('data-view-transition-triggered', 'true');
  }

  /**
   * Sets the srcset for the image
   * @param {HTMLImageElement} image
   */
  #setImageSrcset(image) {
    if (!this.featuredMediaUrl) return;

    const currentImageUrl = new URL(image.currentSrc);

    // Deliberately not using origin, as it includes the protocol, which is usually skipped for featured media
    const currentImageRawUrl = currentImageUrl.host + currentImageUrl.pathname;

    if (!this.featuredMediaUrl.includes(currentImageRawUrl)) {
      const imageFade = image.animate([{ opacity: 0.8 }, { opacity: 1 }], {
        duration: 125,
        easing: 'ease-in-out',
      });

      imageFade.onfinish = () => {
        image.srcset = this.featuredMediaUrl ?? '';
      };
    }
  }
}

if (!customElements.get('product-card-link')) {
  customElements.define('product-card-link', ProductCardLink);
}

/**
 * A custom element that displays a product card.
 * Extends ProductCardLink to inherit view transition functionality.
 *
 * @typedef {object} ProductCardRefs
 * @property {HTMLAnchorElement} productCardLink - The product card link element.
 * @property {import('slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {import('quick-add').QuickAddComponent} [quickAdd] - The quick add component.
 * @property {HTMLElement} [cardGallery] - The card gallery component.
 * @property {HTMLImageElement[]} [imagesToTransition] - The images to transition.
 * @extends {ProductCardLink<ProductCardRefs>}
 */
export class ProductCard extends ProductCardLink {
  requiredRefs = ['productCardLink'];

  get productPageUrl() {
    const link = this.refs.productCardLink?.href;
    return link ? this.#sanitizeProductUrl(link) : '';
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null if none selected
   */
  getSelectedVariantId() {
    const selectedVariant = this.#getSelectedVariant();
    if (selectedVariant?.id) {
      return String(selectedVariant.id);
    }

    const checkedInput = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input[type="radio"]:checked[data-variant-id]')
    );

    return checkedInput?.dataset.variantId || null;
  }

  /**
   * Sanitizes a product URL for navigation and quick add preload.
   * @param {string} urlString
   * @returns {string}
   */
  #sanitizeProductUrl(urlString) {
    try {
      const url = new URL(urlString, window.location.origin);
      url.searchParams.delete('section_id');
      url.searchParams.delete('option_values');
      return withCollectionContext(url.toString(), this.dataset.collectionHandle);
    } catch {
      return withCollectionContext(urlString, this.dataset.collectionHandle);
    }
  }

  /**
   * Gets the product card link element
   * @returns {HTMLAnchorElement | null} The product card link or null
   */
  getProductCardLink() {
    return this.refs.productCardLink || null;
  }

  #fetchProductPageHandler = () => {
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl)?.catch(() => {});
  };

  /**
   * Navigates to a URL link. Respects modifier keys for opening in new tab/window.
   * @param {Event} event - The event that triggered the navigation.
   * @param {URL} url - The URL to navigate to.
   */
  #navigateToURL = (event, url) => {
    // Check for modifier keys that should open in new tab/window (only for mouse events)
    const shouldOpenInNewTab =
      event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);

    if (shouldOpenInNewTab) {
      event.preventDefault();
      window.open(url.href, '_blank');
      return;
    } else {
      window.location.href = url.href;
    }
  };

  connectedCallback() {
    super.connectedCallback();

    const link = this.refs.productCardLink;
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Product card link not found');
    this.#handleQuickAdd();

    this.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    this.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected);
    this.addEventListener(SlideshowSelectEvent.eventName, this.#handleSlideshowSelect);
    mediaQueryLarge.addEventListener('change', this.#handleQuickAdd);

    this.addEventListener('click', this.navigateToProduct);
    this.addEventListener('click', this.#storeBreadcrumbCollection);

    // Preload the next image on the slideshow to avoid white flashes on previewImage
    setTimeout(() => {
      if (this.refs.slideshow?.isNested) {
        this.#preloadNextPreviewImage();
      }
      this.#syncSelectedVariantMedia();
      this.#enforceCollectionStyleTitle();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.navigateToProduct);
    this.removeEventListener('click', this.#storeBreadcrumbCollection);
  }

  /**
   * Remembers the source collection for product-page breadcrumbs.
   * @param {Event} event
   */
  #storeBreadcrumbCollection = (event) => {
    const handle = this.dataset.collectionHandle;
    if (!handle || !(event.target instanceof Element)) return;

    const link = event.target.closest('a');
    if (!link || !this.contains(link)) return;

    sessionStorage.setItem('lg_breadcrumb_collection_handle', handle);

    const title = this.dataset.collectionTitle;
    if (title) {
      sessionStorage.setItem('lg_breadcrumb_collection_title', title);
    }
  };

  #preloadNextPreviewImage() {
    const currentSlide = this.refs.slideshow?.slides?.[this.refs.slideshow?.current];
    currentSlide?.nextElementSibling?.querySelector('img[loading="lazy"]')?.removeAttribute('loading');
  }

  /**
   * Handles the quick add event.
   */
  #handleQuickAdd = () => {
    this.removeEventListener('pointerenter', this.#fetchProductPageHandler);
    this.removeEventListener('focusin', this.#fetchProductPageHandler);

    if (isDesktopBreakpoint()) {
      this.addEventListener('pointerenter', this.#fetchProductPageHandler);
      this.addEventListener('focusin', this.#fetchProductPageHandler);
    }
  };

  /**
   * Handles the variant selected event.
   * @param {VariantSelectedEvent} event - The variant selected event.
   */
  #handleVariantSelected = (event) => {
    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateSelectedOption(event.detail.resource.id);
    }
  };

  /**
   * Handles the variant update event.
   * Updates price, checks for unavailable variants, and updates product URL.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    // Stop the event from bubbling up to the section, variant updates triggered from product cards are fully handled
    // by this component and should not affect anything outside the card.
    event.stopPropagation();

    this.updatePrice(event);
    this.#updateTitleFromVariant(event);
    this.#isUnavailableVariantSelected(event);
    this.#updateProductUrl(event);
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl)?.catch(() => {});

    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateVariantPicker(event.detail.data.html);
    }

    this.#updateVariantImages(event);
    this.#previousSlideIndex = null;
    this.#isPreviewingVariant = false;

    const checkedMetal = this.variantPicker?.querySelector('.variant-option--metal-row input:checked');
    if (checkedMetal instanceof HTMLInputElement) {
      this.syncShapeRowForMetal(checkedMetal);
    }

    // Remove attribute after re-rendering since a variant selection has been made
    this.removeAttribute('data-no-swatch-selected');

    // Force overflow list to reflow after variant update
    // This fixes an issue where the overflow counter doesn't update properly in some browsers
    this.#updateOverflowList();
  };

  /**
   * Forces the overflow list to recalculate by dispatching a reflow event.
   * This ensures the overflow counter displays correctly after variant updates.
   */
  #updateOverflowList() {
    // Find the overflow list in the variant picker
    const overflowList = this.querySelector('swatches-variant-picker-component overflow-list');
    const isActiveOverflowList = overflowList?.querySelector('[slot="overflow"]') ? true : false;
    if (!overflowList || !isActiveOverflowList) return;

    // Use requestAnimationFrame to ensure DOM has been updated
    requestAnimationFrame(() => {
      // Dispatch a reflow event to trigger recalculation
      overflowList.dispatchEvent(
        new CustomEvent('reflow', {
          bubbles: true,
          detail: {},
        })
      );
    });
  }

  /**
   * Updates the DOM with a new price.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updatePrice(event) {
    const priceContainer = this.querySelector('product-price [ref="priceContainer"]');
    const newPriceElement = event.detail.data.html.querySelector('product-price [ref="priceContainer"]');

    if (newPriceElement && priceContainer) {
      morph(priceContainer, newPriceElement);
      this.#clearPreviewCache();
    }
  }

  /**
   * Updates the card title from variant data (variant_title replaces title line).
   * On collection pages, never morph raw section HTML into the title — that can
   * reintroduce "in 18K Rose Gold" after the Liquid strip. Always go through
   * #getDisplayTitle so the metal suffix stays hidden.
   * @param {VariantUpdateEvent} event
   */
  #updateTitleFromVariant(event) {
    const variant = event.detail?.resource;
    if (!variant) return;

    this.#clearPreviewCache();

    if (this.#isCollectionCard()) {
      const htmlTitle = event.detail.data.html?.querySelector('[ref="productCardTitle"]');
      const htmlText = htmlTitle?.textContent?.trim() || '';
      if (htmlText && !this.dataset.productStyleTitle) {
        this.dataset.productStyleTitle = this.#stripMetalFromTitle(htmlText);
      }
      this.#updateCardTitle(variant);
    } else {
      const newTitle = event.detail.data.html?.querySelector('[ref="productCardTitle"]');
      const currentTitle = this.#getCardTitleElement();

      if (newTitle && currentTitle) {
        morph(currentTitle, newTitle);
      } else {
        this.#updateCardTitle(variant);
      }
    }

    this.#savedTitleText = this.#getCardTitleElement()?.textContent || '';
  }

  /**
   * Updates the product URL based on the variant update event.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #updateProductUrl(event) {
    const responseProductCard = event.detail.data.html?.querySelector('product-card');
    const anchorElement = responseProductCard?.querySelector('a');
    const featuredMediaUrl = responseProductCard?.getAttribute('data-featured-media-url');

    // Update the featured media URL for view transitions (inherited from ProductCardLink)
    if (featuredMediaUrl) {
      this.setAttribute('data-featured-media-url', featuredMediaUrl);
    }

    const responseCollectionHandle = responseProductCard?.getAttribute('data-collection-handle');

    if (responseCollectionHandle) {
      this.setAttribute('data-collection-handle', responseCollectionHandle);
    }

    if (anchorElement instanceof HTMLAnchorElement) {
      // If the href is empty, don't update the product URL eg: unavailable variant
      if (anchorElement.getAttribute('href')?.trim() === '') return;

      let productUrl = anchorElement.href;
      const variant = event.detail?.resource;

      if (variant?.id) {
        const url = new URL(productUrl, window.location.origin);
        url.searchParams.set('variant', String(variant.id));
        productUrl = this.#sanitizeProductUrl(url.toString());
      } else {
        productUrl = this.#sanitizeProductUrl(productUrl);
      }

      const { productCardLink, productTitleLink, cardGalleryLink } = this.refs;

      productCardLink.href = productUrl;
      if (cardGalleryLink instanceof HTMLAnchorElement) {
        cardGalleryLink.href = productUrl;
      }
      if (productTitleLink instanceof HTMLAnchorElement) {
        productTitleLink.href = productUrl;
      }
    }
  }

  /**
   * Checks if an unavailable variant is selected.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #isUnavailableVariantSelected(event) {
    const allVariants = /** @type {NodeListOf<HTMLInputElement>} */ (
      event.detail.data.html.querySelectorAll('input:checked')
    );

    for (const variant of allVariants) {
      this.#toggleAddToCartButton(variant.dataset.optionAvailable === 'true');
    }
  }

  /**
   * Toggles the add to cart button state.
   * @param {boolean} enable - Whether to enable or disable the button.
   */
  #toggleAddToCartButton(enable) {
    const addToCartButton = this.querySelector('.add-to-cart__button button');

    if (addToCartButton instanceof HTMLButtonElement) {
      addToCartButton.disabled = !enable;
    }
  }

  /**
   * Hide the variant images that are not for the selected variant.
   * @param {VariantUpdateEvent} [event]
   */
  #updateVariantImages(event) {
    const { slideshow } = this.refs;
    if (!slideshow) return;

    const selectedVariant =
      event?.detail?.resource || this.#getSelectedVariant();
    const mediaId =
      selectedVariant?.featured_media?.id ||
      selectedVariant?.featured_media_id ||
      this.#getSelectedVariantMediaId();

    if (!mediaId) return;

    const { slides = [] } = slideshow.refs;

    for (const slide of slides) {
      if (slide.getAttribute('variant-image') == null) continue;

      slide.hidden = slide.getAttribute('slide-id') !== String(mediaId);
    }

    slideshow.select({ id: String(mediaId) }, undefined, { animate: false });
  }

  /**
   * Gets the media id for the first checked swatch input (legacy fallback).
   * @returns {string | undefined}
   */
  #getSelectedVariantMediaId() {
    const selectedOption = this.variantPicker?.selectedOption;
    return selectedOption?.dataset.optionMediaId;
  }

  /**
   * Gets all variant inputs.
   * @returns {NodeListOf<HTMLInputElement>} All variant input elements.
   */
  get allVariants() {
    return this.querySelectorAll('input[data-variant-id]');
  }

  /**
   * Gets the variant picker component.
   * @returns {VariantPicker | null} The variant picker component.
   */
  get variantPicker() {
    return this.querySelector('swatches-variant-picker-component');
  }
  /** @type {string | null} */
  #savedPriceHtml = null;

  /** @type {string | null} */
  #savedTitleText = null;

  /** @type {{ src: string; srcset: string } | null} */
  #savedImageState = null;

  /** @type {boolean} */
  #isPreviewingVariant = false;

  /**
   * Previews a variant from swatch hover.
   * @param {PointerEvent} event - The pointer event.
   */
  previewSwatchOption(event) {
    if (event.pointerType !== 'mouse') return;

    const input = this.#getSwatchInputFromEvent(event);
    if (!(input instanceof HTMLInputElement)) return;

    const variant = this.#resolveVariantFromInput(input);

    this.#isPreviewingVariant = true;
    this.resetVariant.cancel();
    this.#setSwatchPreviewState(input);

    if (input.closest('.variant-option--metal-row')) {
      this.syncShapeRowForMetal(input);
    }

    if (variant) {
      this.#applyVariantPreview(variant, input);
      return;
    }

    this.#applyInputPreview(input);
  }

  /**
   * Syncs the shape row swatches to match the given metal selection.
   * @param {HTMLInputElement} metalInput
   */
  syncShapeRowForMetal(metalInput) {
    const shapeFieldset = this.variantPicker?.querySelector('.variant-option--shape-row');
    if (!(metalInput instanceof HTMLInputElement) || !shapeFieldset) return;

    const metalValue = metalInput.dataset.optionValueName || metalInput.value;
    const shapeInputs = shapeFieldset.querySelectorAll('input[type="radio"]');

    shapeInputs.forEach((shapeInput) => {
      if (!(shapeInput instanceof HTMLInputElement)) return;

      const shapeValue = shapeInput.dataset.optionValueName || shapeInput.value;
      const variant = this.#findVariantByMetalAndShape(metalValue, shapeValue);
      this.#updateShapeSwatchInput(shapeInput, variant);
    });
  }

  /**
   * Selects the best matching shape when metal changes.
   * @param {HTMLInputElement} metalInput
   * @returns {HTMLInputElement | null}
   */
  selectBestShapeForMetal(metalInput) {
    const shapeFieldset = this.variantPicker?.querySelector('.variant-option--shape-row');
    if (!(metalInput instanceof HTMLInputElement) || !shapeFieldset) return null;

    const metalValue = metalInput.dataset.optionValueName || metalInput.value;
    const shapeInputs = /** @type {NodeListOf<HTMLInputElement>} */ (
      shapeFieldset.querySelectorAll('input[type="radio"]')
    );
    const currentChecked = shapeFieldset.querySelector('input[type="radio"]:checked');

    if (currentChecked instanceof HTMLInputElement) {
      const shapeValue = currentChecked.dataset.optionValueName || currentChecked.value;
      if (this.#findVariantByMetalAndShape(metalValue, shapeValue)) {
        this.syncShapeRowForMetal(metalInput);
        return currentChecked;
      }
    }

    for (const shapeInput of shapeInputs) {
      const shapeValue = shapeInput.dataset.optionValueName || shapeInput.value;
      if (!this.#findVariantByMetalAndShape(metalValue, shapeValue)) continue;

      shapeInputs.forEach((input) => {
        input.checked = input === shapeInput;
        input.dataset.currentChecked = input === shapeInput ? 'true' : 'false';
      });

      this.syncShapeRowForMetal(metalInput);
      return shapeInput;
    }

    this.syncShapeRowForMetal(metalInput);
    return null;
  }

  /**
   * Syncs card metal/shape swatches to active collection filter values (vm_color / vm_shape).
   * Updates checked swatches, media, price, title, and product links.
   * @param {{ color?: string, shape?: string }} options
   * @returns {boolean}
   */
  applyCollectionFilterOptions(options = {}) {
    const picker = this.variantPicker;
    if (!picker) return false;

    const color = typeof options.color === 'string' ? options.color.trim() : '';
    const shape = typeof options.shape === 'string' ? options.shape.trim() : '';
    if (!color && !shape) return false;

    let metalInput = null;
    if (color) {
      metalInput = this.#findSwatchInputByValue('.variant-option--metal-row', color);
      if (metalInput) {
        picker.updateSelectedOption(metalInput);
      }
    }

    let shapeInput = null;
    if (shape) {
      shapeInput = this.#findSwatchInputByValue('.variant-option--shape-row', shape);
      if (shapeInput) {
        picker.updateSelectedOption(shapeInput);
      }
    }

    if (metalInput instanceof HTMLInputElement) {
      if (shapeInput) {
        this.syncShapeRowForMetal(metalInput);
      } else {
        this.selectBestShapeForMetal(metalInput);
      }
    }

    const variant = this.#getSelectedVariant();
    if (!variant) return Boolean(metalInput || shapeInput);

    this.#clearPreviewCache();
    this.#isPreviewingVariant = false;
    this.#clearSwatchPreviewState();
    this.#updateCardPrice(variant);
    this.#updateCardTitle(variant);
    this.#clearPreviewCache();
    this.#updateVariantImages();
    this.#updateLinksWithVariantId(variant.id);
    this.removeAttribute('data-no-swatch-selected');

    return true;
  }

  /**
   * Finds a swatch radio whose option value matches the wanted filter label.
   * @param {string} rowSelector
   * @param {string} wantedValue
   * @returns {HTMLInputElement | null}
   */
  #findSwatchInputByValue(rowSelector, wantedValue) {
    const normalize = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();
    const wanted = normalize(wantedValue);
    if (!wanted) return null;

    const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (
      this.querySelectorAll(`${rowSelector} input[type="radio"]`)
    );

    for (const input of inputs) {
      const name = normalize(input.dataset.optionValueName || input.value);
      if (name === wanted) return input;
    }

    const wantedHandle = wanted.replace(/\s+/g, '-');
    for (const input of inputs) {
      const name = normalize(input.dataset.optionValueName || input.value);
      const nameHandle = name.replace(/\s+/g, '-');
      if (nameHandle === wantedHandle) return input;
    }

    return null;
  }

  /**
   * Updates product card links to point at a specific variant.
   * @param {string | number} variantId
   */
  #updateLinksWithVariantId(variantId) {
    if (!variantId) return;

    const links = [this.refs.productCardLink, this.refs.productTitleLink, this.refs.cardGalleryLink];
    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement) || !link.getAttribute('href')?.trim()) continue;
      try {
        const url = new URL(link.href, window.location.origin);
        url.searchParams.set('variant', String(variantId));
        link.href = this.#sanitizeProductUrl(url.toString());
      } catch {
        /* ignore invalid href */
      }
    }
  }

  /**
   * Finds a variant for a metal and shape combination.
   * @param {string} metalValue
   * @param {string} shapeValue
   * @returns {Record<string, any> | null}
   */
  #findVariantByMetalAndShape(metalValue, shapeValue) {
    const { metalPosition, shapePosition } = this.#getMetalAndShapePositions();
    const selectedValues = {};

    if (metalValue) selectedValues[metalPosition] = metalValue;
    if (shapeValue) selectedValues[shapePosition] = shapeValue;

    return this.#resolveVariantFromSelections(selectedValues);
  }

  /**
   * Gets metal and shape option positions from the swatch fieldsets.
   * @returns {{ metalPosition: number, shapePosition: number }}
   */
  #getMetalAndShapePositions() {
    const metalFieldset = this.variantPicker?.querySelector('.variant-option--metal-row');
    const shapeFieldset = this.variantPicker?.querySelector('.variant-option--shape-row');

    return {
      metalPosition: Number.parseInt(metalFieldset?.getAttribute('data-option-position') || '1', 10),
      shapePosition: Number.parseInt(shapeFieldset?.getAttribute('data-option-position') || '2', 10),
    };
  }

  /**
   * Updates a shape swatch input from variant data (swatch image from custom.variant_shape).
   * @param {HTMLInputElement} shapeInput
   * @param {Record<string, any> | null} variant
   */
  #updateShapeSwatchInput(shapeInput, variant) {
    const label = shapeInput.closest('label');
    const swatch = label?.querySelector('.swatch');

    if (!variant) {
      shapeInput.dataset.optionAvailable = 'false';
      return;
    }

    shapeInput.dataset.optionAvailable = 'true';
    shapeInput.dataset.variantId = String(variant.id);

    if (variant.featured_media_id) {
      shapeInput.dataset.optionMediaId = String(variant.featured_media_id);
      label?.setAttribute('data-media-id', String(variant.featured_media_id));
    } else {
      delete shapeInput.dataset.optionMediaId;
      label?.removeAttribute('data-media-id');
    }

    if (variant.price_formatted) {
      shapeInput.dataset.previewPrice = variant.price_formatted;
    }

    if (variant.variant_title) {
      shapeInput.dataset.previewSubtitle = variant.variant_title;
    } else {
      delete shapeInput.dataset.previewSubtitle;
    }

    const swatchUrl = shapeInput.dataset.swatchImageUrl;
    if (swatch instanceof HTMLElement) {
      if (swatchUrl) {
        swatch.style.setProperty('--swatch-background', `url(${swatchUrl})`);
        swatch.classList.add('swatch--variant-image');
      }
    }
  }

  /**
   * Gets the swatch input from a pointer event.
   * @param {PointerEvent} event
   * @returns {HTMLInputElement | null}
   */
  #getSwatchInputFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;

    const label = target.closest('label');
    const input = label?.querySelector('input[type="radio"]');

    return input instanceof HTMLInputElement ? input : null;
  }

  /**
   * Resolves the currently selected variant from all checked swatch inputs.
   * @returns {Record<string, any> | null}
   */
  #getSelectedVariant() {
    const picker = this.variantPicker;
    if (!picker) return null;

    const checkedInputs = picker.querySelectorAll('fieldset input[type="radio"]:checked');
    if (!checkedInputs.length) return null;

    return this.#resolveVariantFromSelections(checkedInputs);
  }

  /**
   * Resolves a variant from swatch inputs.
   * @param {HTMLInputElement} hoveredInput
   * @param {NodeListOf<HTMLInputElement> | HTMLInputElement[]} [checkedInputs]
   * @returns {Record<string, any> | null}
   */
  #resolveVariantFromInput(hoveredInput, checkedInputs) {
    const variants = this.#getProductVariants();
    if (!variants.length) return null;

    const picker = this.variantPicker;
    if (!picker) return null;

    const fieldsets = picker.querySelectorAll('fieldset[data-option-position]');
    /** @type {Record<number, string>} */
    const selectedValues = {};

    fieldsets.forEach((fieldset) => {
      const position = Number.parseInt(fieldset.getAttribute('data-option-position') || '', 10);
      if (Number.isNaN(position)) return;

      let activeInput = null;

      if (fieldset.contains(hoveredInput)) {
        activeInput = hoveredInput;
      } else if (checkedInputs) {
        activeInput = Array.from(checkedInputs).find((input) => fieldset.contains(input)) || null;
      }

      if (!(activeInput instanceof HTMLInputElement)) {
        activeInput = fieldset.querySelector('input[type="radio"]:checked');
      }

      if (!(activeInput instanceof HTMLInputElement)) {
        activeInput = fieldset.querySelector('input[type="radio"]');
      }

      if (activeInput instanceof HTMLInputElement) {
        selectedValues[position] = activeInput.dataset.optionValueName || activeInput.value;
      }
    });

    return this.#resolveVariantFromSelections(selectedValues, hoveredInput);
  }

  /**
   * Finds a variant matching option selections.
   * @param {NodeListOf<HTMLInputElement> | HTMLInputElement[] | Record<number, string>} selections
   * @param {HTMLInputElement} [fallbackInput]
   * @returns {Record<string, any> | null}
   */
  #resolveVariantFromSelections(selections, fallbackInput) {
    const variants = this.#getProductVariants();
    if (!variants.length) return null;

    /** @type {Record<number, string>} */
    let selectedValues = {};

    if (selections instanceof NodeList || Array.isArray(selections)) {
      for (const input of selections) {
        if (!(input instanceof HTMLInputElement)) continue;
        const position = Number.parseInt(input.dataset.optionPosition || '', 10);
        if (!Number.isNaN(position)) {
          selectedValues[position] = input.dataset.optionValueName || input.value;
        }
      }
    } else {
      selectedValues = selections;
    }

    const exactMatch = variants.find((variant) => {
      return (
        (!selectedValues[1] || variant.option1 === selectedValues[1]) &&
        (!selectedValues[2] || variant.option2 === selectedValues[2]) &&
        (!selectedValues[3] || variant.option3 === selectedValues[3])
      );
    });

    if (exactMatch) return exactMatch;

    if (fallbackInput instanceof HTMLInputElement) {
      const fallbackId = fallbackInput.dataset.variantId;
      if (fallbackId) {
        return variants.find((variant) => String(variant.id) === String(fallbackId)) || null;
      }
    }

    return null;
  }

  /**
   * Highlights the swatch being previewed.
   * @param {HTMLInputElement} input
   */
  #setSwatchPreviewState(input) {
    const picker = this.variantPicker;
    if (!picker) return;

    picker.querySelectorAll('[data-swatch-previewing]').forEach((element) => {
      element.removeAttribute('data-swatch-previewing');
    });

    input.closest('label')?.setAttribute('data-swatch-previewing', 'true');
  }

  /**
   * Clears swatch preview highlight state.
   */
  #clearSwatchPreviewState() {
    this.variantPicker?.querySelectorAll('[data-swatch-previewing]').forEach((element) => {
      element.removeAttribute('data-swatch-previewing');
    });
  }

  /**
   * Syncs slideshow media to the combined selected variant.
   */
  #syncSelectedVariantMedia() {
    if (!this.variantPicker) return;

    const checkedMetal = this.variantPicker.querySelector('.variant-option--metal-row input:checked');
    if (checkedMetal instanceof HTMLInputElement) {
      this.syncShapeRowForMetal(checkedMetal);
    }

    this.#updateVariantImages();
  }

  /**
   * Gets embedded product variants data.
   * @returns {Record<string, any>[]}
   */
  #getProductVariants() {
    const script = this.variantPicker?.querySelector('[data-product-variants-json]');
    if (!(script instanceof HTMLScriptElement) || !script.textContent) return [];

    try {
      return JSON.parse(script.textContent);
    } catch {
      return [];
    }
  }

  /**
   * Applies a preview from swatch input data when variant JSON is unavailable.
   * @param {HTMLInputElement} input
   */
  #applyInputPreview(input) {
    const mediaId = input.dataset.optionMediaId;
    if (mediaId) {
      this.#previewVariantMedia({ featured_media_id: mediaId });
    }

    const price = input.dataset.previewPrice;
    const compareAtPrice = input.dataset.previewComparePrice;
    if (price) {
      this.#updateCardPrice({
        price_formatted: price,
        compare_at_price_formatted: compareAtPrice || null,
        compare_at_price: compareAtPrice ? 1 : 0,
        price: 0,
      });
    }

    this.#updateCardTitle(
      input.dataset.previewSubtitle ? { variant_title: input.dataset.previewSubtitle } : {},
      input
    );
  }

  /**
   * Applies a variant preview to the product card (image, price, title).
   * @param {Record<string, any>} variant
   * @param {HTMLInputElement} [input]
   */
  #applyVariantPreview(variant, input) {
    this.#previewVariantMedia(variant);
    this.#updateCardPrice(variant);
    this.#updateCardTitle(variant, input);
  }

  /**
   * Previews the card gallery image from the variant's product media (not metaobject swatch images).
   * @param {Record<string, any>} variant
   */
  #previewVariantMedia(variant) {
    const mediaId = variant.featured_media_id || variant.featured_media?.id;

    if (mediaId) {
      const { slideshow } = this.refs;

      if (slideshow?.refs?.slides) {
        for (const slide of slideshow.refs.slides) {
          if (slide.getAttribute('variant-image') == null) continue;
          const isMatch = slide.getAttribute('slide-id') === String(mediaId);
          slide.hidden = !isMatch;
        }
      }

      this.previewVariant(String(mediaId));
      return;
    }

    const previewUrl = variant.preview_image_url || variant.featured_media_url;
    if (previewUrl) {
      this.#setCardImageFromUrl(previewUrl);
    }
  }

  /**
   * Gets the currently visible product card image.
   * @returns {HTMLImageElement | null}
   */
  #getActiveCardImage() {
    const { imagesToTransition, slideshow } = this.refs;

    const activeFromTransition = imagesToTransition?.find(
      (image) => image.closest('slideshow-slide')?.getAttribute('aria-hidden') === 'false'
    );

    if (activeFromTransition instanceof HTMLImageElement) {
      return activeFromTransition;
    }

    const activeSlide = slideshow?.slides?.[slideshow.current];
    const slideImage = activeSlide?.querySelector('img');

    return slideImage instanceof HTMLImageElement ? slideImage : null;
  }

  /**
   * Swaps the visible card image to a preview URL.
   * @param {string} imageUrl
   */
  #setCardImageFromUrl(imageUrl) {
    const activeImage = this.#getActiveCardImage();
    if (!(activeImage instanceof HTMLImageElement)) return;

    if (this.#savedImageState === null) {
      this.#savedImageState = {
        src: activeImage.currentSrc || activeImage.src,
        srcset: activeImage.srcset,
      };
    }

    activeImage.src = imageUrl;
    activeImage.srcset = `${imageUrl} 800w`;
  }

  /**
   * Restores the card image after hover preview.
   */
  #restoreCardImage() {
    const activeImage = this.#getActiveCardImage();

    if (activeImage instanceof HTMLImageElement && this.#savedImageState) {
      activeImage.src = this.#savedImageState.src;
      activeImage.srcset = this.#savedImageState.srcset;
    }

    this.#savedImageState = null;
  }

  /**
   * Updates the card price from variant data.
   * @param {Record<string, any>} variant
   */
  #updateCardPrice(variant) {
    const priceContainer = this.querySelector('product-price [ref="priceContainer"]');
    if (!(priceContainer instanceof HTMLElement)) return;

    if (this.#savedPriceHtml === null) {
      this.#savedPriceHtml = priceContainer.innerHTML;
    }

    const price = variant.price_formatted;
    const compareAtPrice = variant.compare_at_price_formatted;
    const hasComparePrice = variant.compare_at_price && variant.compare_at_price > variant.price;

    const regularPrice = priceContainer.querySelector('.price__regular .price');
    const salePrice = priceContainer.querySelector('.price__sale .price-item--sale');
    const comparePrice = priceContainer.querySelector('.price__sale .compare-at-price');
    const regularBlock = priceContainer.querySelector('.price__regular');
    const saleBlock = priceContainer.querySelector('.price__sale');

    if (hasComparePrice && saleBlock instanceof HTMLElement && regularBlock instanceof HTMLElement) {
      regularBlock.classList.add('price__hidden');
      saleBlock.classList.remove('price__hidden');
      if (salePrice instanceof HTMLElement) salePrice.textContent = price;
      if (comparePrice instanceof HTMLElement) comparePrice.textContent = compareAtPrice;
    } else if (regularPrice instanceof HTMLElement) {
      if (regularBlock instanceof HTMLElement) regularBlock.classList.remove('price__hidden');
      if (saleBlock instanceof HTMLElement) saleBlock.classList.add('price__hidden');
      regularPrice.textContent = price;
    }
  }

  /**
   * Gets the card title heading element.
   * @returns {HTMLElement | null}
   */
  #getCardTitleElement() {
    const byRef = this.querySelector('[ref="productCardTitle"]');
    if (byRef instanceof HTMLElement) return byRef;

    const inLink = this.querySelector('[ref="productTitleLink"] [role="heading"]');
    if (inLink instanceof HTMLElement) return inLink;

    const paragraph = this.querySelector('[ref="productTitleLink"] p');
    return paragraph instanceof HTMLElement ? paragraph : null;
  }

  /**
   * Gets the base product title (not variant title).
   * @returns {string}
   */
  #getProductTitleText() {
    const fromCard = this.dataset.productTitle;
    if (typeof fromCard === 'string' && fromCard.trim()) {
      return fromCard.trim();
    }

    const titleLink = this.querySelector('[ref="productTitleLink"]');
    if (titleLink instanceof HTMLElement) {
      const fromLink = titleLink.dataset.productBaseTitle;
      if (typeof fromLink === 'string' && fromLink.trim()) {
        return fromLink.trim();
      }
    }

    return '';
  }

  /**
   * Whether this card is rendered on a collection (or search grid) page.
   * @returns {boolean}
   */
  #isCollectionCard() {
    if (this.dataset.collectionHandle) return true;
    if (document.body?.classList?.contains('template-collection')) return true;
    if (document.body?.classList?.contains('template-search')) return true;
    return Boolean(
      this.closest('results-list, .product-grid-container, .main-collection-grid, .product-grid')
    );
  }

  /**
   * Title line: custom.variant_title when set, otherwise product title
   * (collection cards strip leading/trailing metal from the product title).
   * @param {Record<string, any>} [variant]
   * @param {HTMLInputElement} [input]
   * @returns {string}
   */
  #getDisplayTitle(variant, input) {
    // Collection: always strip from full product title so prefixes like
    // "18K Rose Gold …" / "Platinum …" stay hidden even after async updates.
    if (this.#isCollectionCard()) {
      const fullTitle = this.dataset.productTitle || this.#getProductTitleText();
      const stripped = this.#stripMetalFromTitle(fullTitle);
      if (stripped) {
        this.dataset.productStyleTitle = stripped;
        return stripped;
      }
      const styleTitle = this.dataset.productStyleTitle;
      if (typeof styleTitle === 'string' && styleTitle.trim()) {
        return this.#stripMetalFromTitle(styleTitle.trim());
      }
    }

    const variantTitle = variant?.variant_title;
    if (variantTitle != null && String(variantTitle).trim() !== '') {
      return this.#stripMetalFromTitle(String(variantTitle).trim());
    }

    const inputTitle = input?.dataset.previewSubtitle;
    if (inputTitle != null && String(inputTitle).trim() !== '') {
      return this.#stripMetalFromTitle(String(inputTitle).trim());
    }

    const styleTitle = this.dataset.productStyleTitle;
    if (typeof styleTitle === 'string' && styleTitle.trim()) {
      return this.#stripMetalFromTitle(styleTitle.trim());
    }

    return this.#stripMetalFromTitle(this.#getProductTitleText());
  }

  /**
   * Removes leading/trailing metal from a product title for collection display.
   * Examples:
   * - "18K Rose Gold Radiant Bezel..." → "Radiant Bezel..."
   * - "Platinum Radiant Bezel..." → "Radiant Bezel..."
   * - "Necklace in 18K Rose Gold" → "Necklace"
   * @param {string} title
   * @returns {string}
   */
  #stripMetalFromTitle(title) {
    if (!title) return '';
    if (!this.#isCollectionCard()) return title;

    let result = String(title).trim();

    // Leading metal: "18K Rose Gold …" / "Platinum …"
    result = result
      .replace(
        /^(?:(?:\d+\s*k(?:t)?\s+)?(?:white|yellow|rose|pink)\s+gold|platinum|palladium|sterling\s+silver|silver)\s+/i,
        ''
      )
      .trim();

    // Trailing " in <metal>"
    const parts = result.split(' in ');
    if (parts.length >= 2) {
      const metalTail = parts[parts.length - 1].trim().toLowerCase();
      if (/gold|platinum|silver|palladium|白金|黄金|玫瑰金|白银/.test(metalTail)) {
        result = parts.slice(0, -1).join(' in ').trim();
      }
    }

    return result;
  }

  /**
   * Re-applies the stripped collection title (guards against async variant morph).
   */
  #enforceCollectionStyleTitle() {
    if (!this.#isCollectionCard()) return;

    const titleEl = this.#getCardTitleElement();
    if (!(titleEl instanceof HTMLElement)) return;

    const styleTitle = this.#stripMetalFromTitle(
      this.dataset.productTitle || titleEl.textContent || this.dataset.productStyleTitle || ''
    );
    if (!styleTitle) return;

    this.dataset.productStyleTitle = styleTitle;
    this.#savedTitleText = styleTitle;

    if (titleEl.textContent?.trim() !== styleTitle) {
      titleEl.textContent = styleTitle;
    }

    const titleLink = this.querySelector('[ref="productTitleLink"]');
    if (titleLink instanceof HTMLElement) {
      titleLink.dataset.productBaseTitle = styleTitle;
    }
  }

  /**
   * Updates the card title line from variant data.
   * @param {Record<string, any>} variant
   * @param {HTMLInputElement} [input]
   */
  #updateCardTitle(variant, input) {
    const titleEl = this.#getCardTitleElement();
    if (!(titleEl instanceof HTMLElement)) return;

    const nextTitle = this.#getDisplayTitle(variant, input);

    if (this.#savedTitleText === null) {
      this.#savedTitleText = this.#isCollectionCard()
        ? nextTitle
        : titleEl.textContent || '';
    }

    titleEl.textContent = nextTitle;

    if (this.#isCollectionCard() && nextTitle) {
      this.dataset.productStyleTitle = nextTitle;
      this.#savedTitleText = nextTitle;
    }
  }

  /**
   * Restores saved price and title after hover preview.
   */
  #restoreCardPreviewState() {
    const priceContainer = this.querySelector('product-price [ref="priceContainer"]');
    if (priceContainer instanceof HTMLElement && this.#savedPriceHtml !== null) {
      priceContainer.innerHTML = this.#savedPriceHtml;
    }

    const titleEl = this.#getCardTitleElement();
    if (titleEl instanceof HTMLElement) {
      if (this.#isCollectionCard()) {
        this.#enforceCollectionStyleTitle();
      } else {
        const selectedVariant = this.#getSelectedVariant();
        if (selectedVariant) {
          titleEl.textContent = this.#getDisplayTitle(selectedVariant);
        } else if (this.#savedTitleText !== null) {
          titleEl.textContent = this.#savedTitleText;
        } else {
          const productTitle = this.#getProductTitleText();
          if (productTitle) titleEl.textContent = productTitle;
        }
      }
    }

    this.#restoreCardImage();
  }

  /**
   * Clears cached preview state.
   */
  #clearPreviewCache() {
    this.#savedPriceHtml = null;
    this.#savedTitleText = null;
    this.#savedImageState = null;
  }

  /** @type {number | null} */
  #previousSlideIndex = null;

  /**
   * Handles the slideshow select event.
   * @param {SlideshowSelectEvent} event - The slideshow select event.
   */
  #handleSlideshowSelect = (event) => {
    if (event.detail.userInitiated) {
      this.#previousSlideIndex = event.detail.index;
    }
  };

  /**
   * Previews a variant.
   * @param {string} id - The id of the variant to preview.
   */
  previewVariant(id) {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.resetVariant.cancel();
    slideshow.select({ id }, undefined, { animate: false });
  }

  /**
   * Previews the next image.
   * @param {PointerEvent} event - The pointer event.
   */
  previewImage(event) {
    if (event.pointerType !== 'mouse') return;

    const { slideshow } = this.refs;

    if (!slideshow || typeof slideshow.select !== 'function') return;

    this.resetVariant.cancel();

    if (this.#previousSlideIndex != null && this.#previousSlideIndex > 0) {
      slideshow.select(this.#previousSlideIndex, undefined, { animate: false });
    } else if (typeof slideshow.next === 'function') {
      slideshow.next(undefined, { animate: false });
      setTimeout(() => this.#preloadNextPreviewImage());
    } else if (typeof slideshow.nextIndex === 'number') {
      slideshow.select(slideshow.nextIndex, undefined, { animate: false });
      setTimeout(() => this.#preloadNextPreviewImage());
    }
  }

  /**
   * Resets the image to the variant image.
   * @param {PointerEvent} event - The pointer event.
   */
  resetImage(event) {
    if (event.pointerType !== 'mouse') return;

    const { slideshow } = this.refs;

    if (!this.variantPicker) {
      if (!slideshow) return;
      if (typeof slideshow.previous === 'function') {
        slideshow.previous(undefined, { animate: false });
      } else if (typeof slideshow.select === 'function' && typeof slideshow.previousIndex === 'number') {
        slideshow.select(slideshow.previousIndex, undefined, { animate: false });
      }
    } else {
      this.#resetVariant();
    }
  }

  /**
   * Resets the image to the variant image.
   */
  #resetVariant = () => {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.#isPreviewingVariant = false;
    this.#clearSwatchPreviewState();
    this.#restoreCardPreviewState();
    this.#clearPreviewCache();

    const selectedVariant = this.#getSelectedVariant();
    if (selectedVariant) {
      this.#updateCardTitle(selectedVariant);
      this.#clearPreviewCache();
    }

    const checkedMetal = this.variantPicker?.querySelector('.variant-option--metal-row input:checked');
    if (checkedMetal instanceof HTMLInputElement) {
      this.syncShapeRowForMetal(checkedMetal);
    }

    this.#restoreCardImage();

    const mediaId =
      selectedVariant?.featured_media_id ||
      selectedVariant?.featured_media?.id ||
      this.#getSelectedVariantMediaId();

    if (mediaId && slideshow?.refs?.slides) {
      for (const slide of slideshow.refs.slides) {
        if (slide.getAttribute('variant-image') == null) continue;
        const isMatch = slide.getAttribute('slide-id') === String(mediaId);
        slide.hidden = !isMatch;
      }
    }

    if (mediaId) {
      slideshow.select({ id: String(mediaId) }, undefined, { animate: false });
      return;
    }

    // No variant selected - use initial slide if it's valid
    const initialSlide = slideshow.initialSlide;
    const slideId = initialSlide?.getAttribute('slide-id');
    if (initialSlide && slideshow.slides?.includes(initialSlide) && slideId) {
      slideshow.select({ id: slideId }, undefined, { animate: false });
      return;
    }

    // No valid initial slide or selected variant - go to previous
    if (typeof slideshow.previous === 'function') {
      slideshow.previous(undefined, { animate: false });
    } else if (typeof slideshow.select === 'function' && typeof slideshow.previousIndex === 'number') {
      slideshow.select(slideshow.previousIndex, undefined, { animate: false });
    }
  };

  /**
   * Intercepts the click event on the product card anchor, we want
   * to use this to add an intermediate state to the history.
   * This intermediate state captures the page we were on so that we
   * navigate back to the same page when the user navigates back.
   * In addition to that, it captures the product card anchor so that we
   * have the specific product card in view.
   *
   * A product card can have other interactive elements like variant picker,
   * so we do not navigate if the click was on one of those elements.
   *
   * @param {Event} event
   */
  navigateToProduct = (event) => {
    if (!(event.target instanceof Element)) return;

    // Don't navigate if this product card is marked as no-navigation (e.g., in theme editor)
    if (this.hasAttribute('data-no-navigation')) return;

    const interactiveElement = event.target.closest('button, input, label, select, [tabindex="1"]');

    // If the click was on an interactive element, do nothing.
    if (interactiveElement) {
      return;
    }

    const link = this.refs.productCardLink;
    if (!link.href) return;
    const linkURL = new URL(link.href);

    const productCardAnchor = link.getAttribute('id');
    if (!productCardAnchor) return;

    const infiniteResultsList = this.closest('results-list[infinite-scroll="true"]');
    if (!window.Shopify.designMode && infiniteResultsList) {
      const url = new URL(window.location.href);
      const parent = this.closest('li');
      url.hash = productCardAnchor;
      if (parent && parent.dataset.page) {
        url.searchParams.set('page', parent.dataset.page);
      }

      yieldToMainThread().then(() => {
        history.replaceState({}, '', url.toString());
      });
    }

    const targetLink = event.target.closest('a');
    // Let the native navigation handle the click if it was on a link.
    if (!targetLink) {
      this.#navigateToURL(event, linkURL);
    }
  };

  /**
   * Resets the variant.
   */
  resetVariant = debounce(this.#resetVariant, 100);
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}

/**
 * A custom element that displays a variant picker with swatches.
 * @typedef {import('@theme/variant-picker').VariantPickerRefs & {overflowList: HTMLElement}} SwatchesRefs
 */

/**
 * @extends {VariantPicker<SwatchesRefs>}
 */
class SwatchesVariantPickerComponent extends VariantPicker {
  connectedCallback() {
    super.connectedCallback();

    // Cache the parent product card
    this.parentProductCard = this.closest('product-card');

    // Listen for variant updates to apply pending URL changes
    this.addEventListener(ThemeEvents.variantUpdate, this.#handleCardVariantUrlUpdate.bind(this));
  }

  /**
   * Updates the card URL when a variant is selected.
   */
  #handleCardVariantUrlUpdate() {
    if (this.pendingVariantId && this.parentProductCard instanceof ProductCard) {
      const currentUrl = new URL(
        this.parentProductCard.refs.productCardLink.href,
        window.location.origin
      );
      currentUrl.searchParams.set('variant', this.pendingVariantId);
      currentUrl.searchParams.delete('section_id');
      currentUrl.searchParams.delete('option_values');
      this.parentProductCard.refs.productCardLink.href = withCollectionContext(
        currentUrl.toString(),
        this.parentProductCard.dataset.collectionHandle
      );
      this.pendingVariantId = null;
    }
  }

  /**
   * Builds a section-rendering URL that keeps the parent collection context.
   * @param {HTMLElement} selectedOption
   * @param {string | null} [source]
   * @param {string[]} [sourceSelectedOptionsValues]
   * @returns {string}
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    const requestUrl = super.buildRequestUrl(selectedOption, source, sourceSelectedOptionsValues);
    const collectionHandle =
      this.parentProductCard instanceof ProductCard
        ? this.parentProductCard.dataset.collectionHandle
        : undefined;

    return withCollectionContext(requestUrl, collectionHandle);
  }

  /**
   * Override the variantChanged method to handle unavailable swatches with available alternatives.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const isSwatchInput = event.target instanceof HTMLInputElement && event.target.name?.includes('-swatch');
    const clickedSwatch = event.target;
    const availableCount = parseInt(clickedSwatch.dataset.availableCount || '0');
    const firstAvailableVariantId = clickedSwatch.dataset.firstAvailableOrFirstVariantId;

    if (isSwatchInput && availableCount > 0 && firstAvailableVariantId) {
      event.stopPropagation();
      this.updateSelectedOption(clickedSwatch);

      const collectionHandle =
        this.parentProductCard instanceof ProductCard
          ? this.parentProductCard.dataset.collectionHandle
          : undefined;
      const productUrl = withCollectionContext(
        this.dataset.productUrl?.split('?')[0] || '',
        collectionHandle
      );
      if (!productUrl) return;

      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set('variant', firstAvailableVariantId);
      url.searchParams.set('section_id', 'section-rendering-product-card');

      this.pendingVariantId = firstAvailableVariantId;
      this.fetchUpdatedSection(url.href);
      return;
    }

    if (isSwatchInput && this.parentProductCard instanceof ProductCard) {
      this.updateSelectedOption(clickedSwatch);

      const selectedOption = /** @type {HTMLInputElement} */ (clickedSwatch);

      if (selectedOption.closest('.variant-option--metal-row')) {
        this.parentProductCard.selectBestShapeForMetal(selectedOption);
      }

      this.dispatchEvent(
        new VariantSelectedEvent({
          id: selectedOption.dataset.optionValueId ?? '',
        })
      );

      const requestUrl = this.buildRequestUrl(selectedOption);
      this.fetchUpdatedSection(requestUrl);
      return;
    }

    super.variantChanged(event);
  }

  /**
   * Shows all swatches.
   * @param {Event} [event] - The event that triggered the show all swatches.
   */
  showAllSwatches(event) {
    event?.preventDefault();

    const { overflowList } = this.refs;

    if (overflowList instanceof OverflowList) {
      overflowList.showAll();
    }
  }
}

if (!customElements.get('swatches-variant-picker-component')) {
  customElements.define('swatches-variant-picker-component', SwatchesVariantPickerComponent);
}
