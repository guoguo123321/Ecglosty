import { Component } from '@theme/component';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * Builds a cart permalink and lets shoppers share it so others can open the same cart and checkout.
 * Desktop prefers clipboard copy; native share is only used on mobile where it is reliable.
 * @extends {Component}
 */
class CartShareComponent extends Component {
  /** @type {boolean} */
  #busy = false;

  /**
   * @param {Event} [event]
   */
  async shareCart(event) {
    event?.preventDefault();
    if (this.#busy) return;

    this.#busy = true;
    this.#setStatus('');

    try {
      const shareUrl = await this.#buildShareUrl();
      if (!shareUrl) {
        this.#setStatus(this.dataset.emptyMessage || '');
        return;
      }

      if (this.#shouldUseNativeShare()) {
        const shareData = {
          title: this.dataset.shareTitle || document.title,
          text: this.dataset.shareText || '',
          url: shareUrl,
        };

        try {
          await navigator.share(shareData);
          this.#setStatus(this.dataset.sharedMessage || '');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Fall through to clipboard when the OS share sheet fails (common on Windows).
        }
      }

      await this.#copyShareUrl(shareUrl);
      this.#setStatus(this.dataset.copiedMessage || '');
    } catch (_error) {
      this.#setStatus(this.dataset.errorMessage || '');
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Native share sheets are unreliable on many desktop browsers (especially Windows).
   * @returns {boolean}
   */
  #shouldUseNativeShare() {
    if (typeof navigator.share !== 'function') return false;
    if (!isMobileBreakpoint()) return false;
    return true;
  }

  /**
   * @param {string} shareUrl
   */
  async #copyShareUrl(shareUrl) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      return;
    }

    const input = document.createElement('textarea');
    input.value = shareUrl;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  /**
   * @returns {Promise<string | null>}
   */
  async #buildShareUrl() {
    const response = await fetch(`${Theme.routes.cart_url}.js`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) throw new Error('Failed to load cart');

    /** @type {{ items?: Array<{ variant_id: number; quantity: number }>; note?: string }} */
    const cart = await response.json();
    const items = cart.items || [];

    if (!items.length) return null;

    const path = items.map((item) => `${item.variant_id}:${item.quantity}`).join(',');
    const url = new URL(`${Theme.routes.cart_url}/${path}`, window.location.origin);
    url.searchParams.set('storefront', 'true');

    if (cart.note) {
      url.searchParams.set('note', cart.note);
    }

    return url.toString();
  }

  /**
   * @param {string} message
   */
  #setStatus(message) {
    const status = /** @type {HTMLElement | undefined} */ (this.refs.status);
    if (!status) return;

    status.textContent = message;
    status.classList.toggle('visually-hidden', !message);
  }
}

if (!customElements.get('cart-share-component')) {
  customElements.define('cart-share-component', CartShareComponent);
}
