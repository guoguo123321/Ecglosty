import { Component } from '@theme/component';
import { debounce, onDocumentLoaded, setHeaderMenuStyle } from '@theme/utilities';
import { MegaMenuHoverEvent } from '@theme/events';
import { initCustomMegaMenus } from '@theme/mega-menu-custom';

/**
 * A custom element that manages a header menu.
 *
 * @typedef {Object} State
 * @property {HTMLElement | null} activeItem - The currently active menu item.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} overflowMenu - The overflow menu.
 * @property {HTMLElement[]} [submenu] - The submenu in each respective menu item.
 *
 * @extends {Component<Refs>}
 */
class HeaderMenu extends Component {
  requiredRefs = ['overflowMenu'];

  /**
   * @type {MutationObserver | null}
   */
  #submenuMutationObserver = null;

  connectedCallback() {
    super.connectedCallback();

    // Immediate inject (no debounce): panel stores are SSR'd and desktop header-menu
    // no longer hydrates, so we must not leave a pending/blank window.
    const reinjectNow = () => initCustomMegaMenus(this);
    const reinjectDebounced = debounce(reinjectNow, 50);

    this.#watchMegaMenuUpdates(reinjectNow, reinjectDebounced);

    reinjectNow();

    onDocumentLoaded(() => {
      reinjectNow();
    });
    onDocumentLoaded(this.#preloadImages);
    window.addEventListener('resize', this.#resizeListener);
    window.visualViewport?.addEventListener('resize', this.#resizeListener);
    this.overflowMenu?.addEventListener('pointerleave', this.#overflowSubmenuListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    window.visualViewport?.removeEventListener('resize', this.#resizeListener);
    document.body.removeEventListener('pointermove', this.#onPointerMove);
    if (this.#state.activeItem) {
      this.#stopPointerTracking(this.#state.activeItem);
    }
    this.overflowMenu?.removeEventListener('pointerleave', this.#overflowSubmenuListener);
    this.#cleanupMutationObserver();
  }

  /**
   * Debounced resize/zoom: sync drawer vs horizontal menu.
   * Header overflow-list stays disabled — no More reflow.
   */
  #resizeListener = debounce(() => {
    setHeaderMenuStyle();
  }, 100);

  /**
   * Re-inject mega menus after header hydration or panel store updates.
   * Desktop header-menu skips hydration morph; this is a safety net for registry
   * updates and localized pages where section hydration may be late or missing.
   * @param {() => void} reinjectNow
   * @param {() => void} reinjectDebounced
   */
  #watchMegaMenuUpdates(reinjectNow, reinjectDebounced) {
    const headerSection = this.closest('.header-section');
    const headerComponent = this.closest('header-component');
    const registry = headerComponent?.querySelector('.header-section__mega-blocks-registry');

    const reinjectAndRefresh = () => {
      reinjectNow();
      const activeItem = this.#state.activeItem;
      // megaReady 写在 li 上，activeItem 是 a[ref=menuitem]
      const activeListItem = activeItem?.closest('.menu-list__list-item');
      if (activeItem instanceof HTMLElement && activeListItem?.dataset.megaReady === 'true') {
        this.#updateSubmenuHeight(activeItem);
      }
    };

    if (headerSection instanceof HTMLElement) {
      if (headerSection.dataset.hydrated === 'true') {
        reinjectAndRefresh();
      } else {
        const hydrationObserver = new MutationObserver(() => {
          if (headerSection.dataset.hydrated !== 'true') return;

          hydrationObserver.disconnect();
          // Immediate reinject — no rAF/80ms delay (that window caused blank mega menus).
          reinjectAndRefresh();
        });

        hydrationObserver.observe(headerSection, {
          attributes: true,
          attributeFilter: ['data-hydrated'],
        });

        // Localized pages (/de, /fr, …) may never finish hydration.
        setTimeout(() => {
          hydrationObserver.disconnect();
          reinjectAndRefresh();
        }, 800);
      }
    }

    if (registry instanceof HTMLElement) {
      const storeObserver = new MutationObserver(() => {
        // Do not wait for data-hydrated — stores are SSR'd; locales may never hydrate.
        reinjectDebounced();
      });
      storeObserver.observe(registry, { childList: true, subtree: true });
    }
  }

  /**
   * Recalculate and apply submenu height for an active item.
   * @param {HTMLElement} item
   */
  #updateSubmenuHeight(item) {
    if (!this.headerComponent) return;

    const submenu = findSubmenu(item);
    if (!submenu) return;

    const finalHeight = submenu.offsetHeight || 0;
    this.headerComponent.style.setProperty('--submenu-height', `${finalHeight}px`);
    this.#setFullOpenHeaderHeight(finalHeight);
  }

  #overflowSubmenuListener = () => {
    this.#deactivate();
  };

  /**
   * @type {State}
   */
  #state = {
    activeItem: null,
  };

  /**
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  #pointerIdleTimer;

  /**
   * Last known pointer position for Safari hit-test reconciliation.
   * @type {{ x: number, y: number }}
   */
  #lastPointer = { x: 0, y: 0 };

  /**
   * Update the safety box idle state on the active menu item.
   * @param {PointerEvent} event
   */
  #onPointerMove = (event) => {
    const activeLink = this.#state.activeItem;
    if (!activeLink) return;

    this.#lastPointer.x = event.clientX;
    this.#lastPointer.y = event.clientY;

    const moving = Math.abs(event.movementX) >= 1 || event.movementY >= 1;
    activeLink.dataset.safetyBox = `${moving}`;

    clearTimeout(this.#pointerIdleTimer);
    if (moving) {
      this.#pointerIdleTimer = setTimeout(() => {
        if (this.#state.activeItem) {
          this.#state.activeItem.dataset.safetyBox = 'false';
          this.#reconcilePointerTarget();
        }
      }, 50);
    } else {
      this.#reconcilePointerTarget();
    }
  };

  /**
   * Check if the pointer is over a different menu item and trigger activation if so.
   * Works around Safari not re-evaluating hit targets after pseudo-element changes.
   */
  #reconcilePointerTarget() {
    const { x, y } = this.#lastPointer;
    requestAnimationFrame(() => {
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      const listItem = target.closest('.menu-list__list-item');
      if (listItem && !listItem.contains(this.#state.activeItem)) {
        listItem.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      }
    });
  }

  /**
   * Begin pointer tracking for the safety box on the newly active item.
   * @param {HTMLElement} item
   * @param {HTMLElement | null} previousItem
   */
  #startPointerTracking(item, previousItem) {
    if (previousItem) {
      this.#stopPointerTracking(previousItem);
    } else {
      document.body.addEventListener('pointermove', this.#onPointerMove);
    }

    const rect = item.getBoundingClientRect();
    const isOverlap = this.headerComponent?.hasAttribute('data-submenu-overlap-bottom-row');
    const boundary = isOverlap ? this.headerComponent?.querySelector('.header__row--top') : this.headerComponent;
    item.style.setProperty('--box-height', `${(boundary?.getBoundingClientRect().bottom ?? 0) - rect.top}px`);
  }

  /**
   * Stop pointer tracking and remove all safety box properties from an item.
   * @param {HTMLElement} item
   */
  #stopPointerTracking(item) {
    clearTimeout(this.#pointerIdleTimer);
    this.#pointerIdleTimer = undefined;
    item.style.removeProperty('--box-height');
    delete item.dataset.safetyBox;
  }

  /**
   * Get the overflow menu
   */
  get overflowMenu() {
    return /** @type {HTMLElement | null} */ (this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow"]'));
  }

  /**
   * Whether the overflow list is hovered
   * @returns {boolean}
   */
  get overflowListHovered() {
    return this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow-list"]')?.matches(':hover') ?? false;
  }

  get headerComponent() {
    return /** @type {HTMLElement | null} */ (this.closest('header-component'));
  }

  /**
   * Activate the selected menu item immediately
   * @param {PointerEvent | FocusEvent} event
   */
  activate = (event) => {
    this.dispatchEvent(new MegaMenuHoverEvent());

    if (!(event.target instanceof Element) || !this.headerComponent) return;

    let item = findMenuItem(event.target);

    if (!item || item == this.#state.activeItem) return;

    const listItem = item.closest('.menu-list__list-item');
    const isDefaultSlot = event.target.slot === '';
    const isCustomMega =
      listItem instanceof HTMLElement &&
      (listItem.dataset.megaJsMatched === 'true' ||
        listItem.dataset.megaJsMatched === 'yes' ||
        listItem.dataset.megaAwaitJs === 'true');

    // 仅在尚未注入时初始化；每次 activate 都 reinject 会拆掉当前悬停的 <a>，导致「看得见链接但点不了」
    // 不依赖 data-hydrated：多语言页可能一直不 hydration，panel store 已 SSR 即可注入。
    if (
      isCustomMega &&
      listItem instanceof HTMLElement &&
      listItem.dataset.megaReady !== 'true'
    ) {
      initCustomMegaMenus(this);
    }

    this.dataset.overflowExpanded = (!isDefaultSlot).toString();

    const previouslyActiveItem = this.#state.activeItem;

    if (previouslyActiveItem) {
      previouslyActiveItem.ariaExpanded = 'false';
    }

    this.#state.activeItem = item;
    this.ariaExpanded = 'true';
    item.ariaExpanded = 'true';

    let submenu = findSubmenu(item);

    if (isCustomMega && listItem instanceof HTMLElement && listItem.dataset.megaReady === 'true') {
      submenu = findSubmenu(item);
    }

    const hasSubmenu = Boolean(submenu);

    if (!hasSubmenu && !isDefaultSlot) {
      submenu = this.overflowMenu;
    }

    if (submenu) {
      // Mark submenu as active for content-visibility optimization
      submenu.dataset.active = '';

      // Cleanup any existing mutation observer from previous menu activations
      this.#cleanupMutationObserver();

      // Monitor DOM mutations to catch deferred content injection (from section hydration)
      this.#submenuMutationObserver = new MutationObserver(() => {
        requestAnimationFrame(() => {
          // Double requestAnimationFrame to ensure the height is properly calculated and not defaulting to the contain-intrinsic-size
          requestAnimationFrame(() => {
            if (submenu.offsetHeight > 0) {
              const height = submenu.offsetHeight;
              this.headerComponent?.style.setProperty('--submenu-height', `${height}px`);
              this.#setFullOpenHeaderHeight(height);
              this.#cleanupMutationObserver();
            }
          });
        });
      });
      this.#submenuMutationObserver.observe(submenu, { childList: true, subtree: true });

      // Auto-disconnect after 500ms to prevent memory leaks
      setTimeout(() => {
        this.#cleanupMutationObserver();
      }, 500);
    }

    let finalHeight = submenu?.offsetHeight || submenu?.scrollHeight || 0;

    // For overflow menu, the height needs to be either content of the submenu or the total height of the menu list links
    if (!isDefaultSlot) {
      const overflowListHeight = this.#getOverflowListLinksHeight();
      if (hasSubmenu) {
        /* Note: When the submenu is inside the overflow menu, its offsetHeight is not valid due to the lack of padding
         * we could add the padding variables to the submenu.offsetHeight, but measuring the overflowMenu.offsetHeight is just easier */
        const overflowHeight = this.overflowMenu?.offsetHeight || 0;
        finalHeight = Math.max(overflowHeight, overflowListHeight);
      } else {
        finalHeight = overflowListHeight;
      }
    }

    if (!submenu) {
      // If there is no content to open, don't try to open it
      finalHeight = 0;
    }

    const megaReady =
      listItem instanceof HTMLElement && listItem.dataset.megaReady === 'true';

    // 内容已注入即可展开；不要再强依赖 data-hydrated（本地化页可能一直不 hydration）
    if (isCustomMega && !megaReady) {
      finalHeight = 0;
      this.headerComponent.style.setProperty('--submenu-height', '0px');
      this.#setFullOpenHeaderHeight(0);
      this.style.setProperty('--submenu-opacity', '0');
      this.#startPointerTracking(item, previouslyActiveItem);
      return;
    }

    this.headerComponent.style.setProperty('--submenu-height', `${finalHeight}px`);
    this.#setFullOpenHeaderHeight(finalHeight);
    this.style.setProperty('--submenu-opacity', '1');
    this.#startPointerTracking(item, previouslyActiveItem);
    this.#refreshHeightAfterImages(item);
  };

  /**
   * Featured mega images can finish decoding after activate; remeasure so underlay matches content.
   * @param {HTMLElement} item
   */
  #refreshHeightAfterImages(item) {
    const submenu = findSubmenu(item);
    if (!(submenu instanceof HTMLElement) || !this.headerComponent) return;

    const images = Array.from(submenu.querySelectorAll('.mega-menu-custom__img, img'));
    if (!images.length) return;

    const refresh = () => {
      if (this.#state.activeItem !== item) return;
      this.#updateSubmenuHeight(item);
    };

    images.forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return;
      if (img.complete) return;
      img.addEventListener('load', refresh, { once: true });
      img.addEventListener('error', refresh, { once: true });
    });

    // Decode/layout settle after CSS max-height applies
    requestAnimationFrame(() => requestAnimationFrame(refresh));
  }

  /**
   * Deactivate the active item after a delay
   * @param {PointerEvent | FocusEvent} event
   */
  deactivate(event) {
    if (!(event.target instanceof Element)) return;

    const menu = findSubmenu(this.#state.activeItem);
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    const activeListItem = this.#state.activeItem?.closest('.menu-list__list-item');

    // pointerleave：移入子菜单时不要关闭（原先只处理了 blur）
    if (event.type === 'pointerleave' && related && menu?.contains(related)) {
      return;
    }
    if (event.type === 'pointerleave' && related && activeListItem?.contains(related)) {
      return;
    }
    // relatedTarget 为空时（部分浏览器），用最后指针位置判断是否仍在菜单内
    if (event.type === 'pointerleave' && !related && menu) {
      const under = document.elementFromPoint(this.#lastPointer.x, this.#lastPointer.y);
      if (under && (menu.contains(under) || activeListItem?.contains(under))) {
        return;
      }
    }

    const isMovingWithinMenu = related && menu?.contains(document.activeElement);
    const isMovingToSubmenu = related && event.type === 'blur' && menu?.contains(related);
    const isMovingToOverflowMenu =
      related && related.parentElement?.matches('[slot="overflow"]');

    if (isMovingWithinMenu || isMovingToOverflowMenu || isMovingToSubmenu) {
      if (this.#state.activeItem) {
        this.#stopPointerTracking(this.#state.activeItem);
      }
      return;
    }

    this.#deactivate();
  }

  /**
   * Deactivate the active item immediately
   * @param {HTMLElement | null} [item]
   */
  #deactivate = (item = this.#state.activeItem) => {
    if (!item || item != this.#state.activeItem) return;

    // Don't deactivate if the overflow menu or overflow list is still being hovered
    if (this.overflowListHovered || this.overflowMenu?.matches(':hover')) return;

    this.headerComponent?.style.setProperty('--submenu-height', '0px');
    this.#setFullOpenHeaderHeight(0);
    this.style.setProperty('--submenu-opacity', '0');
    this.dataset.overflowExpanded = 'false';

    const submenu = findSubmenu(item);

    document.body.removeEventListener('pointermove', this.#onPointerMove);
    this.#stopPointerTracking(item);

    this.#state.activeItem = null;
    this.ariaExpanded = 'false';
    item.ariaExpanded = 'false';

    // Remove active state from submenu after animation completes
    if (submenu) {
      delete submenu.dataset.active;
    }
  };

  #getOverflowListLinksHeight() {
    const slottedMenuLinks = this.overflowMenu?.querySelector('slot')?.assignedElements();
    if (!slottedMenuLinks) return this.overflowMenu?.offsetHeight || 0;

    /**
     * @param {(submenu: HTMLElement) => void} cb
     */
    const mapSubmenus = (cb) => {
      slottedMenuLinks.forEach((link) => {
        const submenu = /** @type {HTMLElement | null} */ (link.querySelector('[ref="submenu[]"]'));
        if (submenu) {
          cb(submenu);
        }
      });
    };

    mapSubmenus((submenu) => {
      submenu.style.setProperty('display', 'none');
    });
    const height = this.overflowMenu?.offsetHeight || 0;
    mapSubmenus((submenu) => {
      submenu.style.removeProperty('display');
    });
    return height;
  }

  /**
   * Calculate and set the full open header height. If the submenu is not open, the full open header height is 0.
   * @param {number} submenuHeight
   */
  #setFullOpenHeaderHeight(submenuHeight) {
    if (!this.headerComponent) return;

    const isOverlapSituation = this.headerComponent.hasAttribute('data-submenu-overlap-bottom-row');

    const headerVisibleHeight =
      isOverlapSituation && this.headerComponent.offsetHeight > 0
        ? /** @type {HTMLElement | null} */ (this.headerComponent.querySelector('.header__row--top'))?.offsetHeight ?? 0
        : this.headerComponent.offsetHeight;

    const nothingToOpen = submenuHeight === 0;
    const fullOpenHeaderHeight = nothingToOpen ? 0 : submenuHeight + (headerVisibleHeight ?? 0);

    this.headerComponent?.style.setProperty('--full-open-header-height', `${fullOpenHeaderHeight}px`);
  }

  /**
   * Preload images that are set to load lazily.
   */
  #preloadImages = () => {
    const images = this.querySelectorAll('img[loading="lazy"]');
    images?.forEach((image) => image.removeAttribute('loading'));
  };

  #cleanupMutationObserver() {
    this.#submenuMutationObserver?.disconnect();
    this.#submenuMutationObserver = null;
  }
}

if (!customElements.get('header-menu')) {
  customElements.define('header-menu', HeaderMenu);
}

/**
 * Find the closest menu item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findMenuItem(element) {
  if (!(element instanceof Element)) return null;

  if (element?.matches('[slot="more"')) {
    // Select the first overflowing menu item when hovering over the "More" item
    return findMenuItem(element.parentElement?.querySelector('[slot="overflow"]'));
  }

  return element?.querySelector('[ref="menuitem"]');
}

/**
 * Find the closest submenu.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findSubmenu(element) {
  const submenu = element?.parentElement?.querySelector('[ref="submenu[]"]');
  return submenu instanceof HTMLElement ? submenu : null;
}
