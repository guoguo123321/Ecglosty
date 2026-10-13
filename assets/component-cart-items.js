import { Component } from '@theme/component';
import {
  fetchConfig,
  debounce,
  onAnimationEnd,
  prefersReducedMotion,
  resetShimmer,
  startViewTransition,
} from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import {
  ThemeEvents,
  CartUpdateEvent,
  QuantitySelectorUpdateEvent,
  CartAddEvent,
  DiscountUpdateEvent,
} from '@theme/events';
import { cartPerformance } from '@theme/performance';
import { formatMoney } from '@theme/money-formatting';

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
class CartItemsComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {number} */
  #requestId = 0;

  /** @type {Map<number, number>} */
  #pendingQuantities = new Map();

  #debouncedFlushQuantityChanges = debounce(this.#flushQuantityChanges, 120).bind(this);

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantityChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController?.abort();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#onQuantityChange);
  }

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * Updates the UI immediately, then debounces the network request.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantityChange = (event) => {
    if (!(event.target instanceof Node) || !this.contains(event.target)) return;

    const { quantity, cartLine: line } = event.detail;

    // Cart items require a line number
    if (!line) return;

    this.#applyOptimisticQuantityChange(line, quantity);

    if (quantity === 0) {
      this.#pendingQuantities.delete(line);
      return this.onLineItemRemove(line);
    }

    this.#pendingQuantities.set(line, quantity);
    this.#debouncedFlushQuantityChanges();
  };

  /**
   * Flushes pending quantity changes to the cart API.
   * Uses the latest quantity per line so rapid +/- clicks stay responsive.
   */
  #flushQuantityChanges() {
    if (this.#pendingQuantities.size === 0) return;

    // Process one line at a time; newer clicks abort older in-flight requests.
    // Take the first pending entry — if more remain after success, flush again.
    const [[line, quantity]] = this.#pendingQuantities;
    this.#pendingQuantities.delete(line);

    this.updateQuantity({
      line,
      quantity,
      action: 'change',
    }).then(() => {
      if (this.#pendingQuantities.size > 0) {
        this.#flushQuantityChanges();
      }
    });
  }

  /**
   * Instantly mirrors quantity changes in line total + cart count before the API returns.
   * @param {number} line
   * @param {number} quantity
   */
  #applyOptimisticQuantityChange(line, quantity) {
    const lineItemRow = this.refs.cartItemRows[line - 1];
    if (!lineItemRow) return;

    const previousQuantity = parseInt(lineItemRow.dataset.quantity || '0', 10) || 0;
    const quantityDelta = quantity - previousQuantity;

    lineItemRow.dataset.quantity = String(quantity);
    this.#updateOptimisticLinePrice(lineItemRow, quantity);
    this.#updateOptimisticCartCount(quantityDelta);

    // Soft loading cue on the line total only — do not block +/- clicks.
    const textComponent = /** @type {TextComponent | undefined} */ (lineItemRow.querySelector('text-component'));
    if (quantity > 0) {
      // Skip shimmer when we already showed the optimistic price.
      if (!lineItemRow.dataset.finalPrice) {
        textComponent?.shimmer();
      }
    }
  }

  /**
   * @param {HTMLElement} lineItemRow
   * @param {number} quantity
   */
  #updateOptimisticLinePrice(lineItemRow, quantity) {
    const unitPrice = parseInt(lineItemRow.dataset.finalPrice || '', 10);
    if (!Number.isFinite(unitPrice)) return;

    const useCurrencyCode = this.dataset.currencyCodeEnabled === 'true';
    const moneyFormat = useCurrencyCode
      ? this.dataset.moneyWithCurrencyFormat
      : this.dataset.moneyFormat;
    const currency = this.dataset.currency || 'USD';
    if (!moneyFormat) return;

    const textComponent = /** @type {TextComponent | undefined} */ (lineItemRow.querySelector('text-component'));
    if (!textComponent) return;

    const formatted = formatMoney(unitPrice * quantity, moneyFormat, currency);
    textComponent.textContent = formatted;
    textComponent.setAttribute('value', formatted);
    textComponent.removeAttribute('shimmer');
  }

  /**
   * @param {number} quantityDelta
   */
  #updateOptimisticCartCount(quantityDelta) {
    if (!quantityDelta) return;

    const countEl = this.querySelector('[ref="cartItemCount"]');
    if (countEl) {
      const next = Math.max(0, (parseInt(countEl.textContent || '0', 10) || 0) + quantityDelta);
      countEl.textContent = String(next);
    }

    // Cart drawer / page title bubble
    for (const bubbleCount of document.querySelectorAll('.cart-bubble__text-count')) {
      if (!(bubbleCount instanceof HTMLElement)) continue;
      const next = Math.max(0, (parseInt(bubbleCount.textContent || '0', 10) || 0) + quantityDelta);
      bubbleCount.textContent = next > 0 ? String(next) : '';
      bubbleCount.classList.toggle('hidden', next === 0);

      const bubble = bubbleCount.closest('.cart-bubble');
      bubble?.classList.toggle('visually-hidden', next === 0);
      if (next <= 99) {
        bubble?.setAttribute('data-maintain-ratio', '');
      } else {
        bubble?.removeAttribute('data-maintain-ratio');
      }
    }
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  onLineItemRemove(line) {
    const cartItemRowToRemove = this.refs.cartItemRows[line - 1];

    // Optimistic cart count for trash-button removes (qty change to 0 already applied this)
    if (cartItemRowToRemove) {
      const qty = parseInt(cartItemRowToRemove.dataset.quantity || '0', 10) || 0;
      if (qty > 0) {
        this.#updateOptimisticCartCount(-qty);
        cartItemRowToRemove.dataset.quantity = '0';
      }
    }

    this.updateQuantity({
      line,
      quantity: 0,
      action: 'clear',
    });

    if (!cartItemRowToRemove) return;

    const rowsToRemove = [
      cartItemRowToRemove,
      // Get all nested lines of the row to remove
      ...this.refs.cartItemRows.filter((row) => row.dataset.parentKey === cartItemRowToRemove.dataset.key),
    ];

    // If the cart item row is the last row, optimistically trigger the cart empty state
    const isEmptyCart = rowsToRemove.length == this.refs.cartItemRows.length;

    const template = document.getElementById('empty-cart-template');
    if (isEmptyCart && template instanceof HTMLTemplateElement) {
      const clone = document.importNode(template.content, true);

      startViewTransition(() => {
        this.replaceChildren(clone);
      }, [this.isDrawer ? 'empty-cart-drawer' : 'empty-cart-page']);

      return;
    }

    // Add class to the row to trigger the animation
    rowsToRemove.forEach((row) => {
      const remove = () => row.remove();

      if (prefersReducedMotion()) return remove();

      row.style.setProperty('--row-height', `${row.clientHeight}px`);
      row.classList.add('removing');

      // Remove the row after the animation ends
      onAnimationEnd(row, remove);
    });
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} config.line - The line.
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   * @returns {Promise<void>}
   */
  updateQuantity(config) {
    const cartPerformaceUpdateMarker = cartPerformance.createStartingMarker(`${config.action}:user-action`);
    const requestId = ++this.#requestId;

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    // Indicate loading without blocking +/- interactions
    this.classList.add('cart-items-updating');

    const { line, quantity } = config;
    const { cartTotal } = this.refs;

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionsToUpdate = new Set([this.sectionId]);
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionsToUpdate.add(item.dataset.sectionId);
      }
    });

    const body = JSON.stringify({
      line: line,
      quantity: quantity,
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    });

    cartTotal?.shimmer();

    const cartChangeUrl = Theme.routes.cart_change_url.endsWith('.js')
      ? Theme.routes.cart_change_url
      : `${Theme.routes.cart_change_url}.js`;

    return fetch(cartChangeUrl, { ...fetchConfig('json', { body }), signal })
      .then((response) => {
        return response.text();
      })
      .then((responseText) => {
        if (requestId !== this.#requestId) return;

        const parsedResponseText = JSON.parse(responseText);

        resetShimmer(this);

        if (parsedResponseText.errors) {
          this.#handleCartError(line, parsedResponseText);
          return;
        }

        const newSectionHTML = new DOMParser().parseFromString(
          parsedResponseText.sections[this.sectionId],
          'text/html'
        );

        // Grab the new cart item count from a hidden element
        const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
        const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

        // Update data-cart-quantity for all matching variants
        this.#updateQuantitySelectors(parsedResponseText);

        this.dispatchEvent(
          new CartUpdateEvent(parsedResponseText, this.sectionId, {
            itemCount: newCartItemCount,
            source: 'cart-items-component',
            sections: parsedResponseText.sections,
          })
        );

        morphSection(this.sectionId, parsedResponseText.sections[this.sectionId], {
          mode: this.isDrawer ? 'hydration' : 'full',
        });

        this.#updateCartQuantitySelectorButtonStates();
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        console.error(error);
      })
      .finally(() => {
        if (requestId === this.#requestId) {
          this.classList.remove('cart-items-updating');
        }
        cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
      });
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    this.#handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line item index.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (line, parsedResponseText) => {
    const quantitySelector = this.refs.quantitySelectors[line - 1];
    const quantityInput = quantitySelector?.querySelector('input');

    if (!quantityInput) throw new Error('Quantity input not found');

    const restoredQty = parseInt(quantityInput.defaultValue, 10) || 0;
    const lineItemRow = this.refs.cartItemRows[line - 1];
    if (lineItemRow) {
      const currentQty = parseInt(lineItemRow.dataset.quantity || '0', 10) || 0;
      this.#updateOptimisticCartCount(restoredQty - currentQty);
      lineItemRow.dataset.quantity = String(restoredQty);
      this.#updateOptimisticLinePrice(lineItemRow, restoredQty);
    }

    quantityInput.value = quantityInput.defaultValue;

    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement)) throw new Error('Cart item error not found');
    if (!(cartItemErrorContainer instanceof HTMLElement)) throw new Error('Cart item error container not found');

    cartItemError.textContent = parsedResponseText.errors;
    cartItemErrorContainer.classList.remove('hidden');
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = (event) => {
    if (event instanceof DiscountUpdateEvent) {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }
    if (event.target === this) return;

    const cartItemsHtml = event.detail.data.sections?.[this.sectionId];
    if (cartItemsHtml) {
      const drawerComponent = document.querySelector('cart-drawer-component');
      const dialog = drawerComponent?.querySelector('dialog');
      const wasEmptyDrawer = Boolean(
        this.isDrawer &&
          (dialog?.classList.contains('cart-drawer--empty') || !dialog?.querySelector('.cart-drawer__summary'))
      );

      if (wasEmptyDrawer) {
        // First add: replace then hydrate wallets from Section Rendering API.
        this.#replaceDrawerInner(cartItemsHtml);
        void this.#finalizeDrawerAfterFirstAdd(drawerComponent, cartItemsHtml, event);
        return;
      }

      morphSection(this.sectionId, cartItemsHtml, {
        mode: this.isDrawer ? 'hydration' : 'full',
      });

      const liveDialog = document.querySelector('cart-drawer-component dialog');
      if (liveDialog instanceof HTMLDialogElement) {
        this.#syncCartDrawerState(liveDialog, drawerComponent, cartItemsHtml, event);
      }

      this.#updateCartQuantitySelectorButtonStates();
      this.#emitDrawerContentReady();
    } else if (this.isDrawer) {
      this.#refreshDrawerFromSection(event);
    } else {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
    }
  };

  /**
   * Empty→filled needs a second pass: cart/add section HTML often omits Shop Pay / G Pay.
   * @param {Element | null} drawerComponent
   * @param {string} cartItemsHtml
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  async #finalizeDrawerAfterFirstAdd(drawerComponent, cartItemsHtml, event) {
    try {
      await this.#hydrateAcceleratedCheckout();
    } catch (error) {
      console.error(error);
    }

    const dialog = document.querySelector('cart-drawer-component dialog');
    if (dialog instanceof HTMLDialogElement) {
      this.#syncCartDrawerState(dialog, drawerComponent, cartItemsHtml, event);
    }

    this.#updateCartQuantitySelectorButtonStates();
    this.#emitDrawerContentReady();
  }

  /**
   * Inject accelerated checkout buttons from Section Rendering API when missing.
   * cart/add section payloads often omit Shop Pay / G Pay on the first add.
   */
  async #hydrateAcceleratedCheckout() {
    const dialog = document.querySelector('cart-drawer-component dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;

    const hasWallet = Boolean(
      dialog.querySelector(
        'shopify-accelerated-checkout-cart, .additional-checkout-buttons shopify-accelerated-checkout, .additional-checkout-buttons iframe, .additional-checkout-buttons button'
      )
    );
    if (hasWallet) return;

    const sectionId = this.sectionId.replace(/^shopify-section-/, '');
    const url = new URL(window.location.href);
    url.searchParams.set('section_id', sectionId);
    url.searchParams.set('_ts', String(Date.now()));

    const html = await fetch(`${url.pathname}?${url.searchParams.toString()}`, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    }).then((response) => {
      if (!response.ok) throw new Error(`Section fetch failed: ${response.status}`);
      return response.text();
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const freshButtons = doc.querySelector('.additional-checkout-buttons');
    const freshCtas = doc.querySelector('.cart__ctas');
    const liveCtas = dialog.querySelector('.cart__ctas');

    // Prefer swapping the whole CTA block so checkout/share button styles match page render.
    if (liveCtas instanceof Element && freshCtas instanceof Element) {
      liveCtas.replaceWith(document.importNode(freshCtas, true));
      return;
    }

    if (!(liveCtas instanceof Element) || !(freshButtons instanceof Element)) return;
    if (!freshButtons.innerHTML.trim()) return;

    const existing = liveCtas.querySelector('.additional-checkout-buttons');
    const next = document.importNode(freshButtons, true);
    if (existing) existing.replaceWith(next);
    else liveCtas.appendChild(next);
  }

  #emitDrawerContentReady() {
    document.dispatchEvent(new CustomEvent('cart-drawer:content-ready'));
  }

  /**
   * Async fallback when add-to-cart response has no section HTML.
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  async #refreshDrawerFromSection(event) {
    const drawerComponent = document.querySelector('cart-drawer-component');
    try {
      const html = await sectionRenderer.renderSection(this.sectionId, {
        cache: false,
        mode: 'hydration',
      });

      const liveDialog = document.querySelector('cart-drawer-component dialog');
      // Hydration can fail on empty→filled; hard-replace if summary is still missing.
      if (
        liveDialog &&
        !liveDialog.querySelector('.cart-drawer__summary') &&
        typeof html === 'string' &&
        html.includes('cart-drawer__summary')
      ) {
        this.#replaceDrawerInner(html);
      }

      const dialog = document.querySelector('cart-drawer-component dialog');
      if (dialog instanceof HTMLDialogElement) {
        this.#syncCartDrawerState(dialog, drawerComponent, typeof html === 'string' ? html : '', event);
      }

      // Async path finishes after cart-drawer's open wait — reopen with filled markup.
      this.#emitDrawerContentReady();
      if (drawerComponent?.hasAttribute('auto-open')) {
        /** @type {{ showDialog?: () => void } | null} */ (drawerComponent)?.showDialog?.();
      }
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Replaces the drawer hydration root from section HTML (safe for empty→filled).
   * @param {string} cartItemsHtml
   */
  #replaceDrawerInner(cartItemsHtml) {
    const fragment = new DOMParser().parseFromString(cartItemsHtml, 'text/html');
    const newInner = fragment.querySelector('[data-hydration-key="cart-drawer-inner"]');
    const oldInner = document.querySelector('cart-drawer-component [data-hydration-key="cart-drawer-inner"]');
    const liveDialog = document.querySelector('cart-drawer-component dialog');
    const newDialog = fragment.querySelector('cart-drawer-component dialog, dialog.cart-drawer__dialog');

    if (liveDialog instanceof HTMLDialogElement && newDialog instanceof HTMLDialogElement) {
      liveDialog.classList.toggle('cart-drawer--empty', newDialog.classList.contains('cart-drawer--empty'));
      const labelledBy = newDialog.getAttribute('aria-labelledby');
      if (labelledBy) liveDialog.setAttribute('aria-labelledby', labelledBy);
    }

    if (!(newInner instanceof Element) || !(oldInner instanceof Element)) {
      morphSection(this.sectionId, cartItemsHtml, { mode: 'hydration' });
      return;
    }

    oldInner.replaceWith(document.importNode(newInner, true));
  }

  /**
   * Keeps drawer empty-class + modal state in sync after section updates.
   * @param {HTMLDialogElement} dialog
   * @param {Element | null} drawerComponent
   * @param {string} cartItemsHtml
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  #syncCartDrawerState(dialog, drawerComponent, cartItemsHtml, event) {
    const sectionHasSummary = cartItemsHtml.includes('cart-drawer__summary');
    const liveHasSummary = Boolean(dialog.querySelector('.cart-drawer__summary, .cart-form'));
    const cartItemCount = event.detail.resource?.item_count;
    const isEmpty =
      typeof cartItemCount === 'number' ? cartItemCount === 0 : !(sectionHasSummary || liveHasSummary);

    dialog.classList.toggle('cart-drawer--empty', isEmpty);
    dialog.setAttribute('aria-labelledby', isEmpty ? 'cart-drawer-heading-empty' : 'cart-drawer-heading');

    if (!isEmpty) {
      this.#forceFilledDrawerLayout(dialog);
    }

    // If morph/replace demoted the dialog out of the top layer, reopen as modal.
    if (dialog.open && !dialog.matches(':modal')) {
      dialog.close();
      /** @type {{ showDialog?: () => void } | null} */ (drawerComponent)?.showDialog?.();
    }
  }

  /**
   * First-add can leave empty-cart shrink-wrap styles; force a full-width filled layout.
   * @param {HTMLDialogElement} dialog
   */
  #forceFilledDrawerLayout(dialog) {
    dialog.classList.remove('cart-drawer--empty');

    const stretch = (el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('align-self', 'stretch', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    };

    const inner = dialog.querySelector('.cart-drawer__inner');
    if (inner instanceof HTMLElement) {
      inner.style.setProperty('display', 'flex', 'important');
      inner.style.setProperty('flex-direction', 'column', 'important');
      inner.style.setProperty('align-items', 'stretch', 'important');
      inner.style.setProperty('justify-content', 'flex-start', 'important');
      stretch(inner);
    }

    dialog
      .querySelectorAll(
        '.cart-items-component, .cart-drawer__content, .cart-drawer__header, .cart-drawer__summary, .cart-totals, .cart-actions, .cart-note, .cart-discount, .cart__ctas'
      )
      .forEach((el) => stretch(el));

    const summary = dialog.querySelector('.cart-drawer__summary');
    if (summary instanceof HTMLElement) {
      summary.style.setProperty('align-items', 'stretch', 'important');
    }

    dialog.querySelectorAll('.cart-totals__total, .cart-note__summary, .cart-discount__summary').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('display', 'flex', 'important');
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('justify-content', 'space-between', 'important');
    });

    const total = dialog.querySelector('.cart-totals__total');
    if (total instanceof HTMLElement) {
      total.style.setProperty('align-items', 'baseline', 'important');
    }

    // Discount row: keep input + Apply on one line after first-add DOM replace.
    dialog
      .querySelectorAll(
        'accordion-custom.cart-discount details[open] .cart-discount__form, accordion-custom.cart-discount details[open] .cart-discount__content'
      )
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty('display', 'flex', 'important');
        el.style.setProperty('flex-direction', 'row', 'important');
        el.style.setProperty('flex-wrap', 'nowrap', 'important');
        el.style.setProperty('align-items', 'center', 'important');
        el.style.setProperty('gap', '12px', 'important');
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('height', 'auto', 'important');
      });
    dialog
      .querySelectorAll('accordion-custom.cart-discount details[open] .cart-discount__input')
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty('flex', '1 1 auto', 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('width', 'auto', 'important');
      });
    dialog
      .querySelectorAll('accordion-custom.cart-discount details[open] .cart-discount__button')
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty('flex', '0 0 auto', 'important');
        el.style.setProperty('width', 'auto', 'important');
        el.style.setProperty('white-space', 'nowrap', 'important');
      });
  }

  /**
   * Updates quantity selectors for all matching variants in the cart.
   * @param {Object} updatedCart - The updated cart object.
   * @param {Array<{variant_id: number, quantity: number}>} [updatedCart.items] - The cart items.
   */
  #updateQuantitySelectors(updatedCart) {
    if (!updatedCart.items) return;

    for (const item of updatedCart.items) {
      const variantId = item.variant_id.toString();
      const selectors = document.querySelectorAll(`quantity-selector-component[data-variant-id="${variantId}"]`);

      for (const selector of selectors) {
        const input = selector.querySelector('input[data-cart-quantity]');
        if (!input) continue;

        input.setAttribute('data-cart-quantity', item.quantity.toString());

        // Update the quantity selector's internal state
        if ('updateCartQuantity' in selector && typeof selector.updateCartQuantity === 'function') {
          selector.updateCartQuantity();
        }
      }
    }
  }

  /**
   * Updates button states for all cart quantity selector components.
   */
  #updateCartQuantitySelectorButtonStates() {
    for (const selector of document.querySelectorAll('cart-quantity-selector-component')) {
      /** @type {any} */ (selector).updateButtonStates?.();
    }
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error('Section id missing');

    return sectionId;
  }

  /**
   * @returns {boolean} Whether the component is a drawer.
   */
  get isDrawer() {
    return this.dataset.drawer !== undefined;
  }
}

if (!customElements.get('cart-items-component')) {
  customElements.define('cart-items-component', CartItemsComponent);
}
