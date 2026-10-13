import { DialogComponent, DialogOpenEvent, DialogCloseEvent } from '@theme/dialog';
import { CartAddEvent } from '@theme/events';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement} [liveRegion] - The live region for cart announcements when dialog is open.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {AbortController | null} */
  #historyAbortController = null;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.addEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    // Capture: animate close before native <details> snaps shut.
    this.addEventListener('click', this.#onCartAccordionSummaryClick, true);

    if (history.state?.cartDrawerOpen) {
      history.replaceState(null, '');
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.removeEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.removeEventListener('click', this.#onCartAccordionSummaryClick, true);
    this.#historyAbortController?.abort();
  }

  /**
   * Native <details> removes content instantly on close; animate height/opacity first.
   * @param {MouseEvent} event
   */
  #onCartAccordionSummaryClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const summary = target.closest('.cart-note__summary, .cart-discount__summary');
    if (!(summary instanceof HTMLElement) || !this.contains(summary)) return;

    const details = summary.closest('details');
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;

    // Already mid-close animation
    if (details.dataset.closing === 'true') {
      event.preventDefault();
      return;
    }

    const content = details.querySelector(':scope > .details-content, .details-content');
    if (!(content instanceof HTMLElement)) return;

    event.preventDefault();
    details.dataset.closing = 'true';

    const durationMs = 300;
    const startHeight = content.scrollHeight;
    content.style.setProperty('overflow', 'hidden', 'important');
    content.style.setProperty('block-size', `${startHeight}px`, 'important');
    content.style.setProperty('opacity', '1', 'important');
    content.style.setProperty('padding-block', getComputedStyle(content).paddingBlock, 'important');

    // Force reflow, then animate to collapsed.
    void content.offsetHeight;
    content.style.setProperty(
      'transition',
      `block-size ${durationMs}ms ease, opacity ${durationMs}ms ease, padding-block ${durationMs}ms ease`,
      'important'
    );
    content.style.setProperty('block-size', '0px', 'important');
    content.style.setProperty('opacity', '0', 'important');
    content.style.setProperty('padding-block', '0px', 'important');

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      details.open = false;
      delete details.dataset.closing;
      content.style.removeProperty('overflow');
      content.style.removeProperty('block-size');
      content.style.removeProperty('opacity');
      content.style.removeProperty('padding-block');
      content.style.removeProperty('transition');
    };

    content.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, durationMs + 80);
  };

  #handleHistoryOpen = () => {
    if (!isMobileBreakpoint()) return;

    if (!history.state?.cartDrawerOpen) {
      history.pushState({ cartDrawerOpen: true }, '');
    }

    this.#historyAbortController = new AbortController();
    window.addEventListener('popstate', this.#handlePopState, { signal: this.#historyAbortController.signal });
  };

  #handleHistoryClose = () => {
    this.#historyAbortController?.abort();
    if (history.state?.cartDrawerOpen) {
      history.back();
    }
  };

  #handlePopState = async () => {
    if (this.refs.dialog?.open) {
      this.refs.dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
      await this.closeDialog();
      this.refs.dialog.style.removeProperty('--dialog-drawer-closing-animation');
    }
  };

  /**
   * Handles cart add events - opens drawer if auto-open and announces count when open.
   * @param {CustomEvent<{ resource?: { item_count?: number } }>} event
   */
  #handleCartAdd = (event) => {
    let opened = false;

    const open = () => {
      if (opened) return;
      opened = true;
      this.#syncEmptyState(event);
      if (this.hasAttribute('auto-open')) {
        this.showDialog();
      }
      this.#announceCartCount(event.detail.resource?.item_count);
      requestAnimationFrame(() => this.#updateStickyState());
    };

    // Prefer opening after cart-items finishes empty→filled + wallet hydration.
    document.addEventListener('cart-drawer:content-ready', open, { once: true });
    // Fallback for paths that don't emit the event.
    setTimeout(open, 600);
  };

  /**
   * Clears stale empty-cart styles after the first add.
   * @param {CustomEvent<{ resource?: { item_count?: number } }>} event
   */
  #syncEmptyState(event) {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    const itemCount = event.detail?.resource?.item_count;
    const hasSummary = Boolean(dialog.querySelector('.cart-drawer__summary, .cart-form'));
    const isEmpty = typeof itemCount === 'number' ? itemCount === 0 : !hasSummary;

    dialog.classList.toggle('cart-drawer--empty', isEmpty);
    dialog.setAttribute('aria-labelledby', isEmpty ? 'cart-drawer-heading-empty' : 'cart-drawer-heading');

    if (!isEmpty) {
      dialog.classList.remove('cart-drawer--empty');
      const inner = dialog.querySelector('.cart-drawer__inner');
      if (inner instanceof HTMLElement) {
        inner.style.setProperty('align-items', 'stretch', 'important');
        inner.style.setProperty('width', '100%', 'important');
      }
      const summary = dialog.querySelector('.cart-drawer__summary');
      if (summary instanceof HTMLElement) {
        summary.style.setProperty('width', '100%', 'important');
        summary.style.setProperty('align-items', 'stretch', 'important');
      }
      dialog.querySelectorAll('.cart-totals, .cart-actions, .cart__ctas, .cart-totals__total').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.style.setProperty('width', '100%', 'important');
      });
      const total = dialog.querySelector('.cart-totals__total');
      if (total instanceof HTMLElement) {
        total.style.setProperty('display', 'flex', 'important');
        total.style.setProperty('justify-content', 'space-between', 'important');
      }
    }
  }

  /**
   * Announces cart count to screen readers when dialog is open.
   * @param {number | undefined} cartCount
   */
  #announceCartCount(cartCount) {
    const liveRegion = /** @type {HTMLElement | undefined} */ (this.refs.liveRegion);
    if (!this.refs.dialog?.open || !liveRegion || cartCount === undefined) return;

    liveRegion.textContent = `${Theme.translations.cart_count}: ${cartCount}`;
  }

  open() {
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}
