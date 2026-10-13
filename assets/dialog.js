import { Component } from '@theme/component';
import { debounce, isClickedOutside, onAnimationEnd } from '@theme/utilities';

/**
 * A custom element that manages a dialog.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog – The dialog element.
 *
 * @extends Component<Refs>
 */
export class DialogComponent extends Component {
  requiredRefs = ['dialog'];

  connectedCallback() {
    super.connectedCallback();

    if (this.minWidth || this.maxWidth) {
      window.addEventListener('resize', this.#handleResize);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.minWidth || this.maxWidth) {
      window.removeEventListener('resize', this.#handleResize);
    }
  }

  #handleResize = debounce(() => {
    const { minWidth, maxWidth } = this;

    if (!minWidth && !maxWidth) return;

    const windowWidth = window.innerWidth;
    if (windowWidth < minWidth || windowWidth > maxWidth) {
      this.closeDialog();
    }
  }, 50);

  #previousScrollY = 0;
  #usedBodyFixedLock = false;

  /**
   * Shows the dialog.
   */
  showDialog() {
    const { dialog } = this.refs;

    if (dialog.open) return;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    this.#previousScrollY = scrollY;
    this.#usedBodyFixedLock = false;

    // Kill smooth scrolling for the lock window (base.css sets html { scroll-behavior: smooth })
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');

    // Overflow lock keeps native scroll position — body position:fixed collapses scrollY to 0
    // and often reads as a jump-to-top (especially with smooth scroll / sticky header).
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.documentElement.style.setProperty('--scrollbar-compensation', `${scrollbarWidth}px`);
    }
    document.documentElement.setAttribute('scroll-lock', '');

    // autofocus can make the browser scroll the page toward the dialog's document position
    const autoFocusEl = dialog.querySelector('[autofocus]');
    if (autoFocusEl instanceof HTMLElement) {
      autoFocusEl.dataset.restoreAutofocus = 'true';
      autoFocusEl.removeAttribute('autofocus');
    }

    dialog.showModal();

    // Snap back if showModal / focus moved the page
    if ((window.scrollY || window.pageYOffset || 0) !== scrollY) {
      window.scrollTo(0, scrollY);
    }

    // Mobile Safari may reset scroll when overflow:hidden is applied — use body fixed only then
    if ((window.scrollY || window.pageYOffset || 0) !== scrollY) {
      this.#usedBodyFixedLock = true;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    }

    const focusTarget =
      dialog.querySelector('[data-restore-autofocus]') || dialog.querySelector('.close-button');
    if (focusTarget instanceof HTMLElement) {
      focusTarget.focus({ preventScroll: true });
    }

    this.dispatchEvent(new DialogOpenEvent());

    this.addEventListener('keydown', this.#handleKeyDown);

    // Defer outside-click binding so the same click that opened the dialog
    // (capture → open → bubble) does not immediately close it.
    requestAnimationFrame(() => {
      if (!this.refs.dialog?.open) return;
      this.addEventListener('click', this.#handleClick);
    });
  }

  /**
   * Closes the dialog.
   */
  closeDialog = async () => {
    const { dialog } = this.refs;

    if (!dialog.open) return;

    this.removeEventListener('click', this.#handleClick);
    this.removeEventListener('keydown', this.#handleKeyDown);

    // Force browser to restart animation by resetting it
    // Temporarily remove any existing animation state
    dialog.style.animation = 'none';

    // Force a reflow
    void dialog.offsetWidth;

    // Now add the closing class and restore animation
    dialog.classList.add('dialog-closing');
    dialog.style.animation = '';

    await onAnimationEnd(dialog, undefined, {
      subtree: false,
    });

    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
    document.documentElement.removeAttribute('scroll-lock');
    document.documentElement.style.removeProperty('--scrollbar-compensation');

    if (this.#usedBodyFixedLock) {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      document.body.style.paddingRight = '';
    }

    window.scrollTo({ top: this.#previousScrollY, left: 0, behavior: 'instant' });
    document.documentElement.style.removeProperty('scroll-behavior');

    const autoFocusEl = dialog.querySelector('[data-restore-autofocus]');
    if (autoFocusEl instanceof HTMLElement) {
      autoFocusEl.setAttribute('autofocus', '');
      delete autoFocusEl.dataset.restoreAutofocus;
    }

    dialog.close();
    dialog.classList.remove('dialog-closing');
    this.#usedBodyFixedLock = false;

    this.dispatchEvent(new DialogCloseEvent());
  };

  /**
   * Toggles the dialog.
   */
  toggleDialog = () => {
    if (this.refs.dialog.open) {
      this.closeDialog();
    } else {
      this.showDialog();
    }
  };

  /**
   * Closes the dialog when the user clicks outside of it.
   *
   * @param {MouseEvent} event - The mouse event.
   */
  #handleClick(event) {
    const { dialog } = this.refs;

    if (isClickedOutside(event, dialog)) {
      this.closeDialog();
    }
  }

  /**
   * Closes the dialog when the user presses the escape key.
   *
   * @param {KeyboardEvent} event - The keyboard event.
   */
  #handleKeyDown(event) {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    this.closeDialog();
  }

  /**
   * Gets the minimum width of the dialog.
   *
   * @returns {number} The minimum width of the dialog.
   */
  get minWidth() {
    return Number(this.getAttribute('dialog-active-min-width'));
  }

  /**
   * Gets the maximum width of the dialog.
   *
   * @returns {number} The maximum width of the dialog.
   */
  get maxWidth() {
    return Number(this.getAttribute('dialog-active-max-width'));
  }
}

if (!customElements.get('dialog-component')) customElements.define('dialog-component', DialogComponent);

export class DialogOpenEvent extends CustomEvent {
  constructor() {
    super(DialogOpenEvent.eventName);
  }

  static eventName = 'dialog:open';
}

export class DialogCloseEvent extends CustomEvent {
  constructor() {
    super(DialogCloseEvent.eventName);
  }

  static eventName = 'dialog:close';
}

document.addEventListener(
  'toggle',
  (event) => {
    if (event.target instanceof HTMLDetailsElement) {
      if (event.target.hasAttribute('scroll-lock')) {
        const { open } = event.target;
        if (open) {
          document.documentElement.setAttribute('scroll-lock', '');
        } else {
          document.documentElement.removeAttribute('scroll-lock');
        }
      }
    }
  },
  { capture: true }
);
