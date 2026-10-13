import { Component } from '@theme/component';
import { onDocumentLoaded, changeMetaThemeColor, setHeaderMenuStyle } from '@theme/utilities';

/**
 * @typedef {Object} HeaderComponentRefs
 * @property {HTMLDivElement} headerDrawerContainer - The header drawer container element
 * @property {HTMLElement} headerMenu - The header menu element
 * @property {HTMLElement} headerRowTop - The header top row element
 */

/**
 * @typedef {CustomEvent<{ minimumReached: boolean }>} OverflowMinimumEvent
 */

/**
 * A custom element that manages the site header.
 *
 * @extends {Component<HeaderComponentRefs>}
 */

class HeaderComponent extends Component {
  requiredRefs = ['headerDrawerContainer', 'headerMenu', 'headerRowTop'];

  /**
   * Width of window when header drawer was hidden
   * @type {number | null}
   */
  #menuDrawerHiddenWidth = null;

  /**
   * An intersection observer for monitoring sticky header position
   * @type {IntersectionObserver | null}
   */
  #intersectionObserver = null;

  /**
   * Whether the header has been scrolled offscreen, when sticky behavior is 'scroll-up'
   * @type {boolean}
   */
  #offscreen = false;

  /**
   * The last recorded scrollTop of the document, when sticky behavior is 'scroll-up
   * @type {number}
   */
  #lastScrollTop = 0;

  /**
   * A timeout to allow for hiding animation, when sticky behavior is 'scroll-up'
   * @type {number | null}
   */
  #timeout = null;

  /**
   * RAF ID for scroll handler throttling
   * @type {number | null}
   */
  #scrollRafId = null;

  /**
   * Keeps the global `--header-height` custom property up to date,
   * which other theme components can then consume
   */
  #resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || !entry.borderBoxSize[0]) return;

    // The initial height is calculated using the .offsetHeight property, which returns an integer.
    // We round to the nearest integer to avoid unnecessary reflows.
    const roundedHeaderHeight = Math.round(entry.borderBoxSize[0].blockSize);
    const next = `${roundedHeaderHeight}px`;

    // Skip identical writes — continuous setProperty looks like “CSS shaking” in DevTools
    // even when the page layout does not visibly jump.
    if (document.body.style.getPropertyValue('--header-height') !== next) {
      document.body.style.setProperty('--header-height', next);
    }

    // Check if the menu drawer should be hidden in favor of the header menu
    if (this.#menuDrawerHiddenWidth && window.innerWidth > this.#menuDrawerHiddenWidth) {
      this.#updateMenuVisibility(false);
    }
  });

  /**
   * Observes the header while scrolling the viewport to track when its actively sticky
   * @param {Boolean} alwaysSticky - Determines if we need to observe when the header is offscreen
   */
  #observeStickyPosition = (alwaysSticky = true) => {
    if (this.#intersectionObserver) return;

    const config = {
      threshold: alwaysSticky ? 1 : 0,
    };

    this.#intersectionObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;

      const { isIntersecting } = entry;

      if (alwaysSticky) {
        const nextState = isIntersecting ? 'inactive' : 'active';
        if (this.dataset.stickyState !== nextState) {
          this.dataset.stickyState = nextState;
          if (this.dataset.themeColor) changeMetaThemeColor(this.dataset.themeColor);
        }
      } else {
        this.#offscreen = !isIntersecting || this.dataset.stickyState === 'active';
      }
    }, config);

    this.#intersectionObserver.observe(this);
  };

  /**
   * Handles the overflow minimum event from the header menu
   * @param {OverflowMinimumEvent} event
   */
  #handleOverflowMinimum = (event) => {
    this.#updateMenuVisibility(event.detail.minimumReached);
  };

  /**
   * Updates the visibility of the menu and drawer
   * @param {boolean} hideMenu - Whether to hide the menu and show the drawer
   */
  #updateMenuVisibility(hideMenu) {
    if (hideMenu) {
      this.#menuDrawerHiddenWidth = window.innerWidth;
    } else {
      this.#menuDrawerHiddenWidth = null;
    }
    setHeaderMenuStyle();
  }

  #handleWindowScroll = () => {
    if (this.#scrollRafId !== null) return;

    this.#scrollRafId = requestAnimationFrame(() => {
      this.#scrollRafId = null;
      this.#updateScrollState();
    });
  };

  #updateScrollState = () => {
    const stickyMode = this.getAttribute('sticky');
    if (!this.#offscreen && stickyMode !== 'always') return;

    const scrollTop = document.scrollingElement?.scrollTop ?? 0;
    const headerTop = this.getBoundingClientRect().top;
    const isScrollingUp = scrollTop < this.#lastScrollTop;
    const isAtTop = headerTop >= 0;

    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
    }

    if (stickyMode === 'always') {
      if (isAtTop) {
        this.#setDataAttr('scrollDirection', 'none');
      } else if (isScrollingUp) {
        this.#setDataAttr('scrollDirection', 'up');
      } else {
        this.#setDataAttr('scrollDirection', 'down');
      }

      this.#lastScrollTop = scrollTop;
      return;
    }

    if (isScrollingUp) {
      if (isAtTop) {
        // reset sticky state when header is scrolled up to natural position
        this.#offscreen = false;
        this.#setDataAttr('stickyState', 'inactive');
        this.#setDataAttr('scrollDirection', 'none');
      } else {
        // show sticky header when scrolling up
        this.#setDataAttr('stickyState', 'active');
        this.#setDataAttr('scrollDirection', 'up');
      }
    } else if (this.dataset.stickyState === 'active') {
      this.#setDataAttr('scrollDirection', 'none');
      this.#setDataAttr('stickyState', 'idle');
    } else {
      this.#setDataAttr('scrollDirection', 'none');
      this.#setDataAttr('stickyState', 'idle');
    }

    this.#lastScrollTop = scrollTop;
  };

  /**
   * Avoid redundant dataset writes (each write retriggers attribute CSS / style calc).
   * @param {'scrollDirection' | 'stickyState'} key
   * @param {string} value
   */
  #setDataAttr(key, value) {
    if (this.dataset[key] === value) return;
    this.dataset[key] = value;
  }

  /**
   * Sync drawer vs desktop menu when crossing tablet/desktop breakpoint
   * @type {MediaQueryList | null}
   */
  #menuStyleMediaQuery = null;

  /**
   * Desktop input capability (hover + fine pointer)
   * @type {MediaQueryList | null}
   */
  #desktopInputMediaQuery = null;

  /**
   * @type {(() => void) | null}
   */
  #handleMenuStyleBreakpoint = null;

  connectedCallback() {
    super.connectedCallback();
    this.#resizeObserver.observe(this);
    this.addEventListener('overflowMinimum', this.#handleOverflowMinimum);

    this.#menuStyleMediaQuery = window.matchMedia('(max-width: 989px)');
    this.#desktopInputMediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    this.#handleMenuStyleBreakpoint = () => setHeaderMenuStyle();
    this.#menuStyleMediaQuery.addEventListener('change', this.#handleMenuStyleBreakpoint);
    this.#desktopInputMediaQuery.addEventListener('change', this.#handleMenuStyleBreakpoint);
    window.visualViewport?.addEventListener('resize', this.#handleMenuStyleBreakpoint);
    setHeaderMenuStyle();

    const stickyMode = this.getAttribute('sticky');
    if (stickyMode) {
      this.#observeStickyPosition(stickyMode === 'always');

      if (stickyMode === 'scroll-up' || stickyMode === 'always') {
        document.addEventListener('scroll', this.#handleWindowScroll);
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resizeObserver.disconnect();
    this.#intersectionObserver?.disconnect();
    this.removeEventListener('overflowMinimum', this.#handleOverflowMinimum);
    if (this.#handleMenuStyleBreakpoint) {
      this.#menuStyleMediaQuery?.removeEventListener('change', this.#handleMenuStyleBreakpoint);
      this.#desktopInputMediaQuery?.removeEventListener('change', this.#handleMenuStyleBreakpoint);
      window.visualViewport?.removeEventListener('resize', this.#handleMenuStyleBreakpoint);
    }
    document.removeEventListener('scroll', this.#handleWindowScroll);
    if (this.#scrollRafId !== null) {
      cancelAnimationFrame(this.#scrollRafId);
      this.#scrollRafId = null;
    }
    document.body.style.setProperty('--header-height', '0px');
  }
}

if (!customElements.get('header-component')) {
  customElements.define('header-component', HeaderComponent);
}

onDocumentLoaded(() => {
  const header = document.querySelector('header-component');
  const headerGroup = document.querySelector('#header-group');

  // Note: Initial header heights are set via inline script in theme.liquid
  // This ResizeObserver handles dynamic updates after page load

  // Update header group height on resize of any child
  if (headerGroup) {
    const resizeObserver = new ResizeObserver((entries) => {
      const headerGroupHeight = entries.reduce((totalHeight, entry) => {
        if (
          entry.target !== header ||
          (header.hasAttribute('transparent') && header.parentElement?.nextElementSibling)
        ) {
          return totalHeight + (entry.borderBoxSize[0]?.blockSize ?? 0);
        }
        return totalHeight;
      }, 0);
      // The initial height is calculated using the .offsetHeight property, which returns an integer.
      // We round to the nearest integer to avoid unnecessary reflows.
      const next = `${Math.round(headerGroupHeight)}px`;
      if (document.body.style.getPropertyValue('--header-group-height') !== next) {
        document.body.style.setProperty('--header-group-height', next);
      }
    });

    if (header instanceof HTMLElement) {
      resizeObserver.observe(header);
    }

    // Observe all children of the header group
    const children = headerGroup.children;
    for (let i = 0; i < children.length; i++) {
      const element = children[i];
      if (element instanceof HTMLElement) {
        resizeObserver.observe(element);
      }
    }

    // Also observe the header group itself for child changes
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Re-observe all children when the list changes
          const children = headerGroup.children;
          for (let i = 0; i < children.length; i++) {
            const element = children[i];
            if (element instanceof HTMLElement) {
              resizeObserver.observe(element);
            }
          }
        }
      }
    });

    mutationObserver.observe(headerGroup, { childList: true });
  }
});
