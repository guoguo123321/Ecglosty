import { sectionRenderer } from '@theme/section-renderer';
import { Component } from '@theme/component';
import { FilterUpdateEvent, ThemeEvents } from '@theme/events';
import { debounce, startViewTransition } from '@theme/utilities';
import { convertMoneyToMinorUnits, formatMoney } from '@theme/money-formatting';
/**
 * Search query parameter.
 * @type {string}
 */
const SEARCH_QUERY = 'q';

/**
 * Handles the main facets form functionality
 *
 * @typedef {Object} FacetsFormRefs
 * @property {HTMLFormElement} facetsForm - The main facets form element
 * @property {HTMLElement | undefined} facetStatus - The facet status element
 *
 * @extends {Component<FacetsFormRefs>}
 */
class FacetsFormComponent extends Component {
  requiredRefs = ['facetsForm'];

  /**
   * Creates URL parameters from form data
   * @param {FormData} [formData] - Optional form data to use instead of the main form
   * @returns {URLSearchParams} The processed URL parameters
   */
  createURLParameters(formData = new FormData(this.refs.facetsForm)) {
    let newParameters = new URLSearchParams(/** @type any */ (formData));

    if (newParameters.get('filter.v.price.gte') === '') newParameters.delete('filter.v.price.gte');
    if (newParameters.get('filter.v.price.lte') === '') newParameters.delete('filter.v.price.lte');

    newParameters.delete('page');

    const searchQuery = this.#getSearchQuery();
    if (searchQuery) newParameters.set(SEARCH_QUERY, searchQuery);

    return newParameters;
  }

  /**
   * Gets the search query parameter from the current URL
   * @returns {string} The search query
   */
  #getSearchQuery() {
    const url = new URL(window.location.href);
    return url.searchParams.get(SEARCH_QUERY) ?? '';
  }

  get sectionId() {
    const id = this.getAttribute('section-id');
    if (!id) throw new Error('Section ID is required');
    return id;
  }

  /**
   * Updates the URL hash with current filter parameters
   */
  #updateURLHash() {
    const url = new URL(window.location.href);
    const urlParameters = this.createURLParameters();
    const preservedShape = url.searchParams.get('vm_shape');
    const preservedColor = url.searchParams.get('vm_color');

    url.search = '';
    for (const [param, value] of urlParameters.entries()) {
      url.searchParams.append(param, value);
    }
    if (preservedShape) url.searchParams.set('vm_shape', preservedShape);
    if (preservedColor) url.searchParams.set('vm_color', preservedColor);

    history.pushState({ urlParameters: urlParameters.toString() }, '', url.toString());
  }

  /**
   * Updates filters and renders the section
   */
  updateFilters = () => {
    this.#updateURLHash();
    this.dispatchEvent(new FilterUpdateEvent(this.createURLParameters()));
    this.#updateSection();
  };

  /**
   * Updates the section
   */
  async #updateSection() {
    const viewTransition = !this.closest('dialog');

    if (viewTransition) {
      await startViewTransition(() => sectionRenderer.renderSection(this.sectionId), ['product-grid']);
    } else {
      await sectionRenderer.renderSection(this.sectionId);
    }

    // Section morph replaces strip markup (server has no vm_* active state).
    VariantMetaobjectStripComponent.scheduleApplyClientFilters();
  }

  /**
   * Updates filters based on a provided URL
   * @param {string} url - The URL to update filters with
   */
  async updateFiltersByURL(url) {
    history.pushState('', '', url);
    const nextUrl = new URL(url, window.location.origin);
    this.dispatchEvent(new FilterUpdateEvent(nextUrl.searchParams));
    await this.#updateSection();
  }

  /**
   * Applies deferred facet selections (e.g. variant metaobject strips) and closes the drawer.
   */
  applyFiltersAndClose = () => {
    this.updateFilters();

    const dialogComponent = this.closest('dialog-component');
    if (dialogComponent && typeof dialogComponent.closeDialog === 'function') {
      dialogComponent.closeDialog();
    }
  };
}

if (!customElements.get('facets-form-component')) {
  customElements.define('facets-form-component', FacetsFormComponent);
}

/**
 * @typedef {Object} FacetInputsRefs
 * @property {HTMLInputElement[]} facetInputs - The facet input elements
 */

/**
 * Handles individual facet input functionality
 * @extends {Component<FacetInputsRefs>}
 */
class FacetInputsComponent extends Component {
  get sectionId() {
    const id = this.closest('.shopify-section')?.id;
    if (!id) throw new Error('FacetInputs component must be a child of a section');
    return id;
  }

  /**
   * Updates filters and the selected facet summary
   */
  updateFilters() {
    const facetsForm = this.closest('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#updateSelectedFacetSummary();
  }

  /**
   * Handles keydown events for the facets form
   * @param {KeyboardEvent} event - The keydown event
   */
  handleKeyDown(event) {
    if (!(event.target instanceof HTMLElement)) return;
    const closestInput = event.target.querySelector('input');

    if (!(closestInput instanceof HTMLInputElement)) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      closestInput.checked = !closestInput.checked;
      this.updateFilters();
    }
  }

  /**
   * Handles mouseover events on facet labels
   * @param {MouseEvent} event - The mouseover event
   */
  prefetchPage = debounce((event) => {
    if (!(event.target instanceof HTMLElement)) return;

    const form = this.closest('form');
    if (!form) return;

    const formData = new FormData(form);
    const inputElement = event.target.querySelector('input');

    if (!(inputElement instanceof HTMLInputElement)) return;

    if (!inputElement.checked) formData.append(inputElement.name, inputElement.value);

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    const urlParameters = facetsForm.createURLParameters(formData);

    const url = new URL(window.location.pathname, window.location.origin);

    for (const [key, value] of urlParameters) url.searchParams.append(key, value);

    if (inputElement.checked) url.searchParams.delete(inputElement.name, inputElement.value);

    sectionRenderer.getSectionHTML(this.sectionId, true, url);
  }, 200);

  cancelPrefetchPage = () => this.prefetchPage.cancel();

  /**
   * Updates the selected facet summary
   */
  #updateSelectedFacetSummary() {
    if (!this.refs.facetInputs) return;

    const checkedInputElements = this.refs.facetInputs.filter((input) => input.checked);
    const details = this.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.updateListSummary(checkedInputElements);
  }
}

if (!customElements.get('facet-inputs-component')) {
  customElements.define('facet-inputs-component', FacetInputsComponent);
}

/**
 * @typedef {Object} PriceFacetRefs
 * @property {HTMLInputElement} minInput - The minimum price input
 * @property {HTMLInputElement} maxInput - The maximum price input
 */

/**
 * Handles price facet functionality
 * @extends {Component<PriceFacetRefs>}
 */
class PriceFacetComponent extends Component {
  /** @type {string} */
  currency;
  /** @type {string} */
  moneyFormat;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keydown', this.#onKeyDown);
    this.currency = this.dataset.currency ?? 'USD';
    this.moneyFormat = this.#extractMoneyPlaceholder(this.dataset.moneyFormat ?? '{{amount}}');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#onKeyDown);
  }

  /**
   * Extracts the placeholder from a money format string, removing currency symbols.
   * @param {string} format - The money format (e.g., "${{amount}}", "{{amount}} USD")
   * @returns {string} Just the placeholder (e.g., "{{amount}}")
   */
  #extractMoneyPlaceholder(format) {
    const match = format.match(/{{\s*\w+\s*}}/);
    return match ? match[0] : '{{amount}}';
  }

  /**
   * Handles keydown events to restrict input to valid characters
   * @param {KeyboardEvent} event - The keydown event
   */
  #onKeyDown = (event) => {
    if (event.metaKey) return;

    const pattern = /[0-9]|\.|,|'| |Tab|Backspace|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Escape/;
    if (!event.key.match(pattern)) event.preventDefault();
  };

  /**
   * Updates price filter and results
   */
  updatePriceFilterAndResults() {
    const { minInput, maxInput } = this.refs;

    this.#adjustToValidValues(minInput);
    this.#adjustToValidValues(maxInput);

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
    this.#setMinAndMaxValues();
    this.#updateSummary();
  }

  /**
   * Parses a formatted money value into minor units
   * displayValue can come from user input or API response
   * @param {string} displayValue - The display value (e.g., "10.50" for USD, "9,50" for EUR, "1000" for JPY)
   * @param {string} currency - The currency code
   * @returns {number} The value in minor units
   */
  #parseDisplayValue(displayValue, currency) {
    return convertMoneyToMinorUnits(displayValue, currency) ?? 0;
  }

  /**
   * Adjusts input values to be within valid range
   * @param {HTMLInputElement} input - The input element to adjust
   */
  #adjustToValidValues(input) {
    if (input.value.trim() === '') return;

    const { currency, moneyFormat } = this;
    // Parse the user's input value using currency-aware parsing
    const value = this.#parseDisplayValue(input.value, currency);

    // data-min and data-max now contain raw minor unit values (not formatted)
    const min = this.#parseDisplayValue(input.getAttribute('data-min') ?? '0', currency);
    const max = this.#parseDisplayValue(input.getAttribute('data-max') ?? '0', currency);

    if (value < min) {
      input.value = formatMoney(min, moneyFormat, currency);
    } else if (value > max) {
      input.value = formatMoney(max, moneyFormat, currency);
    }
  }

  /**
   * Sets min and max values for the inputs
   */
  #setMinAndMaxValues() {
    const { minInput, maxInput } = this.refs;

    if (maxInput.value) minInput.setAttribute('data-max', maxInput.value);
    if (minInput.value) maxInput.setAttribute('data-min', minInput.value);
    if (minInput.value === '') maxInput.setAttribute('data-min', '0');
    if (maxInput.value === '') minInput.setAttribute('data-max', maxInput.getAttribute('data-max') ?? '');
  }

  /**
   * Updates the price summary
   */
  #updateSummary() {
    const { minInput, maxInput } = this.refs;
    const details = this.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent?.updatePriceSummary(minInput, maxInput);
  }
}

if (!customElements.get('price-facet-component')) {
  customElements.define('price-facet-component', PriceFacetComponent);
}

/**
 * Handles clearing of facet filters
 * @extends {Component}
 */
class FacetClearComponent extends Component {
  requiredRefs = ['clearButton'];

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('keyup', this.#handleKeyUp);
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Clears the filter
   * @param {Event} event - The click event
   */
  clearFilter(event) {
    if (!(event.target instanceof HTMLElement)) return;

    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
    }

    const container = event.target.closest('facet-inputs-component, price-facet-component');
    container?.querySelectorAll('[type="checkbox"]:checked, input').forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.checked = false;
        input.value = '';
      }
    });

    const details = event.target.closest('details');
    const statusComponent = details?.querySelector('facet-status-component');

    if (!(statusComponent instanceof FacetStatusComponent)) return;

    statusComponent.clearSummary();

    const facetsForm = this.closest('facets-form-component');
    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFilters();
  }

  /**
   * Handles keyup events
   * @param {KeyboardEvent} event - The keyup event
   */
  #handleKeyUp = (event) => {
    if (event.metaKey) return;
    if (event.key === 'Enter') this.clearFilter(event);
  };

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      clearButton.classList.toggle('facets__clear--active', event.shouldShowClearAll());
    }
  };
}

if (!customElements.get('facet-clear-component')) {
  customElements.define('facet-clear-component', FacetClearComponent);
}

/**
 * @typedef {Object} FacetRemoveComponentRefs
 * @property {HTMLInputElement | undefined} clearButton - The button to clear filters
 */

/**
 * Handles removal of individual facet filters
 * @extends {Component<FacetRemoveComponentRefs>}
 */
class FacetRemoveComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Removes the filter
   * @param {Object} data - The data object
   * @param {string} data.form - The form to remove the filter from
   * @param {Event} event - The click event
   */
  removeFilter({ form }, event) {
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
    }

    const url = this.dataset.url;
    if (!url) return;

    // Hide Clear all + divider immediately (before section re-render)
    const { clearButton } = this.refs;
    if (clearButton instanceof Element) {
      const activeClass = this.getAttribute('active-class') || 'active';
      clearButton.classList.remove(activeClass);
    }
    this.classList.remove('facets-horizontal-remove--active');

    const facetsForm = form ? document.getElementById(form) : this.closest('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;

    facetsForm.updateFiltersByURL(url);
  }

  /**
   * Toggle clear button visibility when filters are applied. Happens before the
   * Section Rendering Request resolves.
   *
   * @param {FilterUpdateEvent} event
   */
  #handleFilterUpdate = (event) => {
    const { clearButton } = this.refs;
    const shouldShow = event.shouldShowClearAll();
    if (clearButton instanceof Element) {
      const activeClass = this.getAttribute('active-class') || 'active';
      clearButton.classList.toggle(activeClass, shouldShow);
    }
    // Keep divider (::before) in sync with the clear button — avoid leftover line after hide
    this.classList.toggle('facets-horizontal-remove--active', shouldShow);
  };
}

if (!customElements.get('facet-remove-component')) {
  customElements.define('facet-remove-component', FacetRemoveComponent);
}

/**
 * Handles sorting filter functionality
 *
 * @typedef {Object} SortingFilterRefs
 * @property {HTMLDetailsElement} details - The details element
 * @property {HTMLElement} summary - The summary element
 * @property {HTMLElement} listbox - The listbox element
 *
 * @extends {Component}
 */
class SortingFilterComponent extends Component {
  requiredRefs = ['details', 'summary', 'listbox'];

  /**
   * Handles keyboard navigation in the sorting dropdown
   * @param {KeyboardEvent} event - The keyboard event
   */
  handleKeyDown = (event) => {
    const { listbox } = this.refs;
    if (!(listbox instanceof Element)) return;

    const options = Array.from(listbox.querySelectorAll('[role="option"]'));
    const currentFocused = options.find((option) => option instanceof HTMLElement && option.tabIndex === 0);
    let newFocusIndex = currentFocused ? options.indexOf(currentFocused) : 0;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        newFocusIndex = Math.min(newFocusIndex + 1, options.length - 1);
        this.#moveFocus(options, newFocusIndex);
        break;

      case 'ArrowUp':
        event.preventDefault();
        newFocusIndex = Math.max(newFocusIndex - 1, 0);
        this.#moveFocus(options, newFocusIndex);
        break;

      case 'Enter':
      case ' ':
        if (event.target instanceof Element) {
          const targetOption = event.target.closest('[role="option"]');
          if (targetOption) {
            event.preventDefault();
            this.#selectOption(targetOption);
          }
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.#closeDropdown();
        break;
    }
  };

  /**
   * Handles details toggle event
   */
  handleToggle = () => {
    const { details, summary, listbox } = this.refs;
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) return;

    const isOpen = details.open;
    summary.setAttribute('aria-expanded', isOpen.toString());

    if (isOpen && listbox instanceof Element) {
      // Move focus to selected option when dropdown opens
      const selectedOption = listbox.querySelector('[aria-selected="true"]');
      if (selectedOption instanceof HTMLElement) {
        selectedOption.focus();
      }
    }
  };

  /**
   * Moves focus between options
   * @param {Element[]} options - The option elements
   * @param {number} newIndex - The index of the option to focus
   */
  #moveFocus(options, newIndex) {
    // Remove tabindex from all options
    options.forEach((option) => {
      if (option instanceof HTMLElement) {
        option.tabIndex = -1;
      }
    });

    // Set tabindex and focus on new option
    const targetOption = options[newIndex];
    if (targetOption instanceof HTMLElement) {
      targetOption.tabIndex = 0;
      targetOption.focus();
    }
  }

  /**
   * Selects an option and triggers form submission
   * @param {Element} option - The option element to select
   */
  #selectOption(option) {
    const input = option.querySelector('input[type="radio"]');
    if (input instanceof HTMLInputElement && option instanceof HTMLElement) {
      // Update aria-selected states
      this.querySelectorAll('[role="option"]').forEach((opt) => {
        opt.setAttribute('aria-selected', 'false');
      });
      option.setAttribute('aria-selected', 'true');

      // Trigger click on the input to ensure normal form behavior
      input.click();

      // Close dropdown and return focus (handles tabIndex reset)
      this.#closeDropdown();
    }
  }

  /**
   * Closes the dropdown and returns focus to summary
   */
  #closeDropdown() {
    const { details, summary } = this.refs;
    if (details instanceof HTMLDetailsElement) {
      // Reset focus to match the actual selected option
      const options = this.querySelectorAll('[role="option"]');
      const selectedOption = this.querySelector('[aria-selected="true"]');

      options.forEach((opt) => {
        if (opt instanceof HTMLElement) {
          opt.tabIndex = -1;
        }
      });

      if (selectedOption instanceof HTMLElement) {
        selectedOption.tabIndex = 0;
      }

      details.open = false;
      if (summary instanceof HTMLElement) {
        summary.focus();
      }
    }
  }

  /**
   * Updates filter and sorting
   * @param {Event} event - The change event
   */
  updateFilterAndSorting(event) {
    const facetsForm =
      this.closest('facets-form-component') || this.closest('.shopify-section')?.querySelector('facets-form-component');

    if (!(facetsForm instanceof FacetsFormComponent)) return;
    const isMobile = window.innerWidth < 750;

    const shouldDisable = this.dataset.shouldUseSelectOnMobile === 'true';

    // Because we have a select element on mobile and a bunch of radio buttons on desktop,
    // we need to disable the input during "form-submission" to prevent duplicate entries.
    if (shouldDisable) {
      if (isMobile) {
        const inputs = this.querySelectorAll('input[name="sort_by"]');
        inputs.forEach((input) => {
          if (!(input instanceof HTMLInputElement)) return;
          input.disabled = true;
        });
      } else {
        const selectElement = this.querySelector('select[name="sort_by"]');
        if (!(selectElement instanceof HTMLSelectElement)) return;
        selectElement.disabled = true;
      }
    }

    facetsForm.updateFilters();
    this.updateFacetStatus(event);
    this.#updateSortLabelFromEvent(event);

    // Re-enable the input after the form-submission
    if (shouldDisable) {
      if (isMobile) {
        const inputs = this.querySelectorAll('input[name="sort_by"]');
        inputs.forEach((input) => {
          if (!(input instanceof HTMLInputElement)) return;
          input.disabled = false;
        });
      } else {
        const selectElement = this.querySelector('select[name="sort_by"]');
        if (!(selectElement instanceof HTMLSelectElement)) return;
        selectElement.disabled = false;
      }
    }

    // Close the details element when a value is selected
    const { details } = this.refs;
    if (!(details instanceof HTMLDetailsElement)) return;
    details.open = false;
  }

  /**
   * Updates the facet status
   * @param {Event} event - The change event
   */
  updateFacetStatus(event) {
    if (!(event.target instanceof HTMLSelectElement)) return;

    const details = this.querySelector('details');
    if (!details) return;

    const facetStatus = details.querySelector('facet-status-component');
    if (!(facetStatus instanceof FacetStatusComponent)) return;

    facetStatus.textContent =
      event.target.value !== details.dataset.defaultSortBy ? event.target.dataset.optionName ?? '' : '';
  }

  /**
   * Updates sort trigger label to "Sort: {option name}".
   * @param {string} optionName
   */
  #updateSortLabel(optionName) {
    const prefix = this.dataset.sortPrefix || 'Sort';
    const labelText = optionName.trim() ? `${prefix}: ${optionName.trim()}` : prefix;

    this.querySelectorAll('[ref="sortLabel"]').forEach((label) => {
      label.textContent = labelText;
    });
  }

  /**
   * Updates sort label from a change event.
   * @param {Event} event
   */
  #updateSortLabelFromEvent(event) {
    const { target } = event;

    if (target instanceof HTMLSelectElement) {
      const selectedOption = target.selectedOptions[0];
      this.#updateSortLabel(selectedOption?.textContent || '');
      return;
    }

    if (target instanceof HTMLInputElement && target.name === 'sort_by') {
      this.#updateSortLabel(target.dataset.optionName || '');
    }
  }
}

if (!customElements.get('sorting-filter-component')) {
  customElements.define('sorting-filter-component', SortingFilterComponent);
}

/**
 * @typedef {Object} FacetStatusRefs
 * @property {HTMLElement} facetStatus - The facet status element
 */

/**
 * Handles facet status display
 * @extends {Component<FacetStatusRefs>}
 */
class FacetStatusComponent extends Component {
  /**
   * Updates the list summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   */
  updateListSummary(checkedInputElements) {
    const checkedInputElementsCount = checkedInputElements.length;

    this.getAttribute('facet-type') === 'swatches'
      ? this.#updateSwatchSummary(checkedInputElements, checkedInputElementsCount)
      : this.#updateBubbleSummary(checkedInputElements, checkedInputElementsCount);
  }

  /**
   * Updates the swatch summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   * @param {number} checkedInputElementsCount - The number of checked inputs
   */
  #updateSwatchSummary(checkedInputElements, checkedInputElementsCount) {
    const { facetStatus } = this.refs;
    facetStatus.classList.remove('bubble', 'facets__bubble');

    if (checkedInputElementsCount === 0) {
      facetStatus.innerHTML = '';
      return;
    }

    if (checkedInputElementsCount > 3) {
      facetStatus.innerHTML = checkedInputElementsCount.toString();
      facetStatus.classList.add('bubble', 'facets__bubble');
      return;
    }

    facetStatus.innerHTML = Array.from(checkedInputElements)
      .map((inputElement) => {
        const swatch = inputElement.parentElement?.querySelector('span.swatch');
        const span = document.createElement('span');
        span.className = 'visually-hidden';
        span.textContent = inputElement.getAttribute('aria-label') ?? '';
        return (swatch?.outerHTML ?? '') + span.outerHTML;
      })
      .join('');
  }

  /**
   * Updates the bubble summary
   * @param {HTMLInputElement[]} checkedInputElements - The checked input elements
   * @param {number} checkedInputElementsCount - The number of checked inputs
   */
  #updateBubbleSummary(checkedInputElements, checkedInputElementsCount) {
    const { facetStatus } = this.refs;
    const filterStyle = this.dataset.filterStyle;

    facetStatus.classList.remove('bubble', 'facets__bubble');

    if (checkedInputElementsCount === 0) {
      facetStatus.innerHTML = '';
      return;
    }

    if (filterStyle === 'horizontal' && checkedInputElementsCount === 1) {
      facetStatus.textContent = checkedInputElements[0]?.dataset.label ?? '';
      return;
    }

    facetStatus.innerHTML = checkedInputElementsCount.toString();
    facetStatus.classList.add('bubble', 'facets__bubble');
  }

  /**
   * Updates the price summary
   * @param {HTMLInputElement} minInput - The minimum price input
   * @param {HTMLInputElement} maxInput - The maximum price input
   */
  updatePriceSummary(minInput, maxInput) {
    const minInputValue = minInput.value;
    const maxInputValue = maxInput.value;
    const { facetStatus } = this.refs;

    if (!minInputValue && !maxInputValue) {
      facetStatus.innerHTML = '';
      return;
    }

    const currency = facetStatus.dataset.currency || '';
    const minInputNum = this.#parseCents(minInputValue, '0', currency);
    const maxInputNum = this.#parseCents(maxInputValue, facetStatus.dataset.rangeMax, currency);
    facetStatus.innerHTML = `${this.#formatMoney(minInputNum)}–${this.#formatMoney(maxInputNum)}`;
  }

  /**
   * Parses a decimal number as minor units (cents for most currencies, but adjusted for zero-decimal currencies)
   * @param {string} value - The stringified decimal number to parse
   * @param {string} fallback - The fallback value in case `value` is invalid (formatted string like "11,400")
   * @param {string} currency - The currency code (e.g., 'USD', 'JPY', 'KRW')
   * @returns {number} The money value in minor units
   */
  #parseCents(value, fallback = '0', currency = '') {
    // Try to parse the value
    const result = convertMoneyToMinorUnits(value, currency);
    if (result !== null) return result;

    // Fall back to parsing the fallback string (which may have formatting like "11,400")
    const fallbackResult = convertMoneyToMinorUnits(fallback, currency);
    if (fallbackResult !== null) return fallbackResult;

    // Last resort: clean and parse as integer
    const cleanFallback = fallback.replace(/[^\d]/g, '');
    return parseInt(cleanFallback, 10) || 0;
  }

  /**
   * Formats money, replicated the implementation of the `money` liquid filters
   * @param {number} moneyValue - The money value
   * @returns {string} The formatted money value
   */
  #formatMoney(moneyValue) {
    if (!(this.refs.moneyFormat instanceof HTMLTemplateElement)) return '';

    const format = this.refs.moneyFormat.content.textContent || '{{amount}}';
    const currency = this.refs.facetStatus.dataset.currency || '';

    return formatMoney(moneyValue, format, currency);
  }

  /**
   * Clears the summary
   */
  clearSummary() {
    this.refs.facetStatus.innerHTML = '';
  }
}

if (!customElements.get('facet-status-component')) {
  customElements.define('facet-status-component', FacetStatusComponent);
}

/**
 * Metal / Shape image strip: hover label + peer client filters (AND),
 * matching lucenjuri filter-values behavior across Shape + Metal.
 *
 * @typedef {Object} VariantMetaobjectStripRefs
 * @property {HTMLElement | undefined} labelEl
 *
 * @extends {Component<VariantMetaobjectStripRefs>}
 */
class VariantMetaobjectStripComponent extends Component {
  connectedCallback() {
    super.connectedCallback();
    this.#defaultLabel = this.dataset.defaultLabel || 'All';
    this.addEventListener('pointerover', this.#onPointerOver);
    this.addEventListener('pointerout', this.#onPointerOut);
    this.addEventListener('click', this.#onClick);
    // Only sync the selected UI — collection-wide apply is owned by the
    // page-level bootstrap / click handler to avoid double-fetch races
    // (two strips = two connectedCallbacks).
    VariantMetaobjectStripComponent.syncActiveStateFromUrl();
    this.#syncHeadingFromActive();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerover', this.#onPointerOver);
    this.removeEventListener('pointerout', this.#onPointerOut);
    this.removeEventListener('click', this.#onClick);
  }

  /** @type {string} */
  #defaultLabel = 'All';

  /**
   * @param {PointerEvent} event
   */
  #onPointerOver = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest('.variant-metaobject-strip__item');
    if (!item || !this.contains(item)) return;

    const ctx = VariantMetaobjectStripComponent.#getSectionContext();
    if (ctx) VariantMetaobjectStripComponent.#getCollectionItems(ctx).catch(() => {});

    const label =
      item.querySelector('[data-label]')?.getAttribute('data-label') ||
      item.querySelector('img')?.getAttribute('alt') ||
      '';
    this.#setLabel(label || this.#defaultLabel);
  };

  /**
   * @param {PointerEvent} event
   */
  #onPointerOut = (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && this.contains(related)) return;
    this.#setLabel(this.#defaultLabel);
  };

  /**
   * @param {MouseEvent} event
   */
  #onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('[data-strip-filter]');
    if (!(link instanceof HTMLAnchorElement) || !this.contains(link)) return;

    const href = link.getAttribute('href');
    if (!href) return;

    event.preventDefault();
    event.stopPropagation();

    // Ignore clicks while a collection-wide fetch is in flight.
    if (this.style.pointerEvents === 'none') return;

    // Shape + Metal strips always use peer client filters.
    if (link.dataset.clientFilter === 'true' || link.dataset.filterGroup) {
      this.#toggleClientFilter(link);
      return;
    }

    const nextUrl = new URL(href, window.location.origin);
    for (const filter of VariantMetaobjectStripComponent.#getActiveClientFilters()) {
      const key = filter.group === 'shape' ? 'vm_shape' : 'vm_color';
      nextUrl.searchParams.set(key, filter.value);
    }

    const facetsForm =
      this.closest('facets-form-component') ||
      this.closest('.shopify-section')?.querySelector('facets-form-component');

    if (facetsForm instanceof FacetsFormComponent) {
      facetsForm.updateFiltersByURL(nextUrl.toString());
      return;
    }

    window.location.assign(nextUrl.toString());
  };

  /**
   * @param {HTMLAnchorElement} link
   */
  #toggleClientFilter(link) {
    const ctx = VariantMetaobjectStripComponent.#getSectionContext();
    if (ctx) VariantMetaobjectStripComponent.#getCollectionItems(ctx).catch(() => {});
    const value = link.dataset.filterValue || '';
    const group = link.dataset.filterGroup || '';
    const url = VariantMetaobjectStripComponent.#buildClientFilterUrl({
      toggleGroup: group,
      toggleValue: value,
      multiple: window.matchMedia('(min-width: 750px)').matches,
    });

    history.replaceState(history.state, '', url.toString());
    VariantMetaobjectStripComponent.syncActiveStateFromUrl();

    // Single authoritative apply — do not also fire FilterUpdate here
    // (that used to invalidate the cache mid-fetch and wipe results).
    VariantMetaobjectStripComponent.invalidateFilterCache();
    VariantMetaobjectStripComponent.applyCollectionWideFilter();
  }

  #syncHeadingFromActive() {
    const labels = [...this.querySelectorAll('[data-strip-filter][data-filter-active="true"]')]
      .map((item) => item.getAttribute('data-label') || item.getAttribute('data-filter-value') || '');
    this.#defaultLabel = labels.join(', ') || this.dataset.allLabel || 'All';
    this.dataset.defaultLabel = this.#defaultLabel;
    this.#setLabel(this.#defaultLabel);
  }

  static #normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  /**
   * @param {HTMLElement} card
   * @param {string} group
   * @param {string} wanted
   */
  static #productMatchesFilterValue(card, group, wanted) {
    const normalizedWanted = VariantMetaobjectStripComponent.#normalize(wanted);
    if (!normalizedWanted) return true;

    let options = [];
    try {
      options = JSON.parse(card.dataset.variantOptions || '[]');
    } catch {
      options = [];
    }

    const groupOptions = options.filter((opt) =>
      VariantMetaobjectStripComponent.#optionMatchesGroup(group, opt?.name)
    );
    const pool = groupOptions.length > 0 ? groupOptions : options;

    const variantMatch = pool.some((opt) =>
      (opt?.values || []).some(
        (v) => VariantMetaobjectStripComponent.#normalize(v) === normalizedWanted
      )
    );
    if (variantMatch) return true;

    // Many catalog products encode metal/shape in title or handle, not as a variant option.
    const title = VariantMetaobjectStripComponent.#normalize(card.dataset.productTitle || '');
    if (title.includes(normalizedWanted)) return true;

    const handle =
      card.dataset.productHandle ||
      card.querySelector('a.product-card__link')?.getAttribute('href') ||
      '';
    const normalizedHandle = VariantMetaobjectStripComponent.#normalize(handle);
    const wantedHandle = normalizedWanted.replace(/\s+/g, '-');
    if (normalizedHandle.includes(wantedHandle)) return true;

    // Fallback: visible card title text (covers cards missing data attributes).
    const visibleTitle = VariantMetaobjectStripComponent.#normalize(
      card.querySelector('.product-card__link, [data-product-base-title], h3, h2')?.textContent ||
        card.getAttribute('aria-label') ||
        ''
    );
    if (visibleTitle.includes(normalizedWanted)) return true;

    return false;
  }

  /**
   * @param {string} group
   * @param {string} optionName
   */
  static #optionMatchesGroup(group, optionName) {
    const name = VariantMetaobjectStripComponent.#normalize(optionName);
    if (group === 'shape') {
      return (
        name.includes('shape') ||
        name.includes('diamond') ||
        name.includes('cut') ||
        name.includes('形状') ||
        name.includes('切工')
      );
    }
    return (
      name.includes('color') ||
      name.includes('colour') ||
      name.includes('metal') ||
      name.includes('颜色') ||
      name.includes('金属')
    );
  }

  /**
   * @returns {{group: string, value: string}[]}
   */
  static #getActiveClientFilters() {
    // Prefer URL (survives section re-renders and late module load).
    const fromUrl = VariantMetaobjectStripComponent.#getWantedFiltersFromUrl();
    if (fromUrl.length > 0) return fromUrl;

    /** @type {{group: string, value: string}[]} */
    const filters = [];
    document
      .querySelectorAll(
        'variant-metaobject-strip-component [data-strip-filter][data-filter-active="true"]'
      )
      .forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (el.dataset.clientFilter !== 'true' && !el.dataset.filterGroup) return;
        const group = el.dataset.filterGroup || '';
        const value = el.dataset.filterValue || '';
        if (group && value) filters.push({ group, value });
      });
    return filters;
  }

  /**
   * @returns {{group: string, value: string}[]}
   */
  static #getWantedFiltersFromUrl() {
    const url = new URL(window.location.href);
    /** @type {{group: string, value: string}[]} */
    const filters = [];
    for (const [group, key] of [['shape', 'vm_shape'], ['color', 'vm_color']]) {
      for (const value of (url.searchParams.get(key) || '').split(',').filter(Boolean)) {
        filters.push({ group, value });
      }
    }
    return filters;
  }

  /**
   * Build collection URL with peer vm_* filters.
   * @param {{toggleGroup?: string, toggleValue?: string, multiple?: boolean}} [options]
   */
  static #buildClientFilterUrl(options = {}) {
    const url = new URL(window.location.href);
    url.searchParams.delete('page');

    if (options.toggleGroup === 'shape' || options.toggleGroup === 'color') {
      const key = options.toggleGroup === 'shape' ? 'vm_shape' : 'vm_color';
      const values = (url.searchParams.get(key) || '').split(',').filter(Boolean);
      const value = options.toggleValue || '';
      const selected = values.includes(value);
      const next = options.multiple
        ? selected ? values.filter((item) => item !== value) : [...values, value]
        : selected ? [] : [value];
      url.searchParams.delete(key);
      if (next.length) url.searchParams.set(key, next.join(','));
    }

    return url;
  }

  static #syncClientFilterUrl() {
    const url = VariantMetaobjectStripComponent.#buildClientFilterUrl();
    history.replaceState(history.state, '', url.toString());
  }

  /** @type {number[]} */
  static #applyTimers = [];

  /** @type {MutationObserver | null} */
  static #gridObserver = null;

  /** @type {boolean} */
  static #isApplying = false;

  /** @type {number | null} */
  static #observerDebounce = null;

  /** @type {HTMLElement[]} */
  static #filteredItemsCache = [];

  /** @type {string} */
  static #filterCacheKey = '';

  /** @type {Promise<HTMLElement[]> | null} */
  static #fetchPromise = null;

  /** Monotonic token — only the latest apply may write cache / render. */
  static #applyGeneration = 0;

  static scheduleApplyClientFilters() {
    VariantMetaobjectStripComponent.#applyTimers.forEach((id) => clearTimeout(id));
    // One delayed retry is enough; the old 5-timer spray caused race conditions.
    VariantMetaobjectStripComponent.#applyTimers = [
      window.setTimeout(() => {
        VariantMetaobjectStripComponent.syncActiveStateFromUrl();
        VariantMetaobjectStripComponent.applyCollectionWideFilter();
      }, 0),
    ];
  }

  /**
   * @returns {{ sectionId: string, grid: HTMLElement, lastPage: number, perPage: number, container: HTMLElement } | null}
   */
  static #getSectionContext() {
    const container = document.querySelector('results-list.product-grid-container, results-list');
    if (!(container instanceof HTMLElement)) return null;

    const sectionId = container.getAttribute('section-id');
    const grid = container.querySelector('[ref="grid"], .product-grid');
    if (!sectionId || !(grid instanceof HTMLElement)) return null;

    const lastPage = Math.max(1, parseInt(grid.dataset.lastPage || '1', 10) || 1);
    let perPage = parseInt(grid.dataset.productsPerPage || '0', 10) || 0;
    if (!perPage) {
      perPage = grid.querySelectorAll(':scope > .product-grid__item').length || 24;
    }

    return { sectionId, grid, lastPage, perPage, container };
  }

  /**
   * @param {number} page
   */
  static #buildPageFetchUrl(page) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(page));
    url.searchParams.delete('vm_shape');
    url.searchParams.delete('vm_color');
    url.hash = '';
    return url;
  }

  /**
   * @param {string} html
   * @returns {HTMLElement[]}
   */
  static #extractGridItems(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const grid = doc.querySelector('[ref="grid"], .product-grid');
    if (!(grid instanceof HTMLElement)) return [];

    return [...grid.querySelectorAll(':scope > li.product-grid__item, :scope > [ref="cards[]"]')].filter(
      (el) => el instanceof HTMLElement
    );
  }

  /** @type {string} */
  static #collectionItemsKey = '';

  /** @type {Promise<HTMLElement[]> | null} */
  static #collectionItemsPromise = null;

  /**
   * Reuse the visible server page and cache detached cards across Shape/Metal selections.
   * Native filters and sorting remain part of the cache key.
   * @param {{ sectionId: string, lastPage: number }} ctx
   * @returns {Promise<HTMLElement[]>}
   */
  static #getCollectionItems(ctx) {
    const baseUrl = VariantMetaobjectStripComponent.#buildPageFetchUrl(1);
    baseUrl.searchParams.delete('page');
    baseUrl.searchParams.sort();
    const key = ctx.sectionId + '|' + ctx.lastPage + '|' + baseUrl.toString();
    if (key === VariantMetaobjectStripComponent.#collectionItemsKey &&
        VariantMetaobjectStripComponent.#collectionItemsPromise) {
      return VariantMetaobjectStripComponent.#collectionItemsPromise;
    }
    const grid = document.querySelector('[ref="grid"], .product-grid');
    const currentPage = Number(new URL(window.location.href).searchParams.get('page') || '1');
    const canReusePage = grid instanceof HTMLElement && grid.dataset.vmFilterMode !== 'true';
    const requests = [];
    for (let page = 1; page <= ctx.lastPage; page++) {
      if (canReusePage && page === currentPage) {
        const items = [...grid.querySelectorAll(':scope > li.product-grid__item, :scope > [ref="cards[]"]')]
          .filter((item) => item instanceof HTMLElement)
          .map((item) => /** @type {HTMLElement} */ (item.cloneNode(true)));
        requests.push(Promise.resolve(items));
      } else {
        requests.push(sectionRenderer.getSectionHTML(
          ctx.sectionId, true, VariantMetaobjectStripComponent.#buildPageFetchUrl(page)
        ).then((html) => VariantMetaobjectStripComponent.#extractGridItems(html)));
      }
    }
    const pending = Promise.all(requests).then((pages) => pages.flat());
    VariantMetaobjectStripComponent.#collectionItemsKey = key;
    VariantMetaobjectStripComponent.#collectionItemsPromise = pending;
    pending.catch(() => {
      if (VariantMetaobjectStripComponent.#collectionItemsPromise === pending) {
        VariantMetaobjectStripComponent.#collectionItemsPromise = null;
        VariantMetaobjectStripComponent.#collectionItemsKey = '';
      }
    });
    return pending;
  }

  /**
   * @param {{ sectionId: string, lastPage: number }} ctx
   * @param {{group: string, value: string}[]} activeFilters
   * @param {number} generation
   * @returns {Promise<HTMLElement[]>}
   */
  static async #fetchAllFilteredItems(ctx, activeFilters, generation) {
    /** @type {HTMLElement[]} */
    const matched = [];
    const seenIds = new Set();

    const items = await VariantMetaobjectStripComponent.#getCollectionItems(ctx);
    if (generation !== VariantMetaobjectStripComponent.#applyGeneration) return [];
    const groups = [...new Set(activeFilters.map((filter) => filter.group))];
    for (const source of items) {
      const card = source.querySelector('product-card');
      if (!(card instanceof HTMLElement)) continue;
      const productId = card.dataset.productId || '';
      if (productId && seenIds.has(productId)) continue;
      if (productId) seenIds.add(productId);
      const matches = groups.every((group) =>
        activeFilters.some((filter) => filter.group === group &&
          VariantMetaobjectStripComponent.#productMatchesFilterValue(card, group, filter.value)
        )
      );
      if (!matches) continue;
      const item = /** @type {HTMLElement} */ (source.cloneNode(true));
      item.hidden = false;
      item.removeAttribute('data-group-duplicate');
      item.removeAttribute('data-vm-filtered-out');
      item.classList.remove('product-grid__item--group-duplicate');
      matched.push(item);
    }

    return matched;
  }

  /**
   * @param {number} total
   */
  static #updateProductCount(total) {
    document.querySelectorAll('[data-testid="products-count"] [role="status"]').forEach((el) => {
      if (el instanceof HTMLElement) el.textContent = String(total);
    });
  }

  /**
   * @param {number} totalItems
   * @param {number} currentPage
   * @param {number} totalPages
   */
  static #updateClientPagination(totalItems, currentPage, totalPages) {
    const grid = document.querySelector('[ref="grid"], .product-grid');
    if (!(grid instanceof HTMLElement)) return;

    let pagination =
      grid.parentElement?.querySelector('.pagination:not([data-vm-pagination])') ||
      document.querySelector('.main-collection-grid .pagination:not([data-vm-pagination])');

    if (totalPages <= 1) {
      if (pagination instanceof HTMLElement) {
        pagination.hidden = true;
        pagination.dataset.vmPagination = 'hidden';
      }
      return;
    }

    if (!(pagination instanceof HTMLElement)) {
      pagination = document.createElement('nav');
      pagination.className = 'pagination';
      pagination.setAttribute('aria-label', 'Pagination');
      pagination.dataset.vmClientPagination = 'true';
      grid.insertAdjacentElement('afterend', pagination);
    }

    pagination.hidden = false;
    pagination.removeAttribute('data-vm-pagination');

    document
      .querySelectorAll('.pagination:not([data-vm-client-pagination="true"])')
      .forEach((el) => {
        if (el instanceof HTMLElement) el.hidden = true;
      });

    const baseUrl = new URL(window.location.href);
    baseUrl.searchParams.delete('page');

    const vmShape = baseUrl.searchParams.get('vm_shape');
    const vmColor = baseUrl.searchParams.get('vm_color');

    const pageUrl = (page) => {
      const url = new URL(baseUrl.toString());
      url.searchParams.set('page', String(page));
      if (vmShape) url.searchParams.set('vm_shape', vmShape);
      if (vmColor) url.searchParams.set('vm_color', vmColor);
      return url.toString();
    };

    /** @type {string[]} */
    const parts = [];
    parts.push('<ul class="pagination__list" role="list">');

    if (currentPage > 1) {
      parts.push(
        `<li class="pagination__item"><a href="${pageUrl(currentPage - 1)}" class="pagination__link pagination__link--arrow pagination__link--prev" aria-label="Previous">‹</a></li>`
      );
    } else {
      parts.push(
        '<li class="pagination__item"><span class="pagination__link pagination__link--arrow pagination__link--disabled" aria-disabled="true">‹</span></li>'
      );
    }

    for (let page = 1; page <= totalPages; page++) {
      if (page === currentPage) {
        parts.push(
          `<li class="pagination__item"><span class="pagination__link pagination__link--page pagination__link--current" aria-current="page">${page}</span></li>`
        );
      } else {
        parts.push(
          `<li class="pagination__item"><a href="${pageUrl(page)}" class="pagination__link pagination__link--page" aria-label="Page ${page}">${page}</a></li>`
        );
      }
    }

    if (currentPage < totalPages) {
      parts.push(
        `<li class="pagination__item"><a href="${pageUrl(currentPage + 1)}" class="pagination__link pagination__link--arrow pagination__link--next" aria-label="Next">›</a></li>`
      );
    } else {
      parts.push(
        '<li class="pagination__item"><span class="pagination__link pagination__link--arrow pagination__link--disabled" aria-disabled="true">›</span></li>'
      );
    }

    parts.push('</ul>');
    pagination.innerHTML = parts.join('');
    pagination.dataset.vmClientPagination = 'true';
    pagination.dataset.vmTotalItems = String(totalItems);
  }

  /**
   * @param {number} [pageNum]
   */
  static #renderFilteredPage(pageNum) {
    const ctx = VariantMetaobjectStripComponent.#getSectionContext();
    if (!ctx) return;

    const { grid, perPage, container } = ctx;
    const items = VariantMetaobjectStripComponent.#filteredItemsCache;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage) || 1);
    const page = Math.min(Math.max(1, pageNum || 1), totalPages);
    const start = (page - 1) * perPage;
    const slice = items.slice(start, start + perPage);

    VariantMetaobjectStripComponent.#isApplying = true;
    try {
      grid.dataset.vmFilterMode = 'true';
      grid.innerHTML = '';

      ctx.container.querySelectorAll('[ref="viewMoreNext"], [ref="viewMorePrevious"]').forEach((el) => {
        if (el instanceof HTMLElement) el.hidden = true;
      });

      if (items.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'product-grid__item product-grid__item--empty';
        empty.innerHTML =
          '<div class="main-collection-grid__empty" style="grid-column:1/-1;padding:2rem;text-align:center;">No products found</div>';
        grid.appendChild(empty);
        VariantMetaobjectStripComponent.#updateClientPagination(0, 1, 1);
        VariantMetaobjectStripComponent.#updateProductCount(0);
        container.removeAttribute('data-vm-filter-loading');
        return;
      }

      slice.forEach((item, index) => {
        const clone = item.cloneNode(true);
        if (clone instanceof HTMLElement) {
          clone.hidden = false;
          clone.style.removeProperty('display');
          clone.removeAttribute('data-vm-filtered-out');
          clone.classList.remove(
            ...Array.from(clone.classList).filter((c) => c.startsWith('product-grid__item--'))
          );
          clone.classList.add(`product-grid__item--${index}`);
          grid.appendChild(clone);
        }
      });

      const url = new URL(window.location.href);
      if (page > 1) {
        url.searchParams.set('page', String(page));
      } else {
        url.searchParams.delete('page');
      }
      history.replaceState(history.state, '', url.toString());

      VariantMetaobjectStripComponent.#updateClientPagination(items.length, page, totalPages);
      VariantMetaobjectStripComponent.#updateProductCount(items.length);
      container.removeAttribute('data-vm-filter-loading');
    } finally {
      VariantMetaobjectStripComponent.#isApplying = false;
    }

    VariantMetaobjectStripComponent.syncActiveStateFromUrl();
    // Wait for product-card custom elements to upgrade after cloneNode, then sync swatches.
    requestAnimationFrame(() => {
      VariantMetaobjectStripComponent.syncProductCardsToActiveFilters();
    });
  }

  /**
   * When Metal/Shape strip filters are active, select matching swatches on every product card
   * (image / price / title follow the same variant).
   */
  static syncProductCardsToActiveFilters() {
    const filters = VariantMetaobjectStripComponent.#getActiveClientFilters();
    const color = filters.find((f) => f.group === 'color')?.value || '';
    const shape = filters.find((f) => f.group === 'shape')?.value || '';
    if (!color && !shape) {
      VariantMetaobjectStripComponent.#enforceCollectionStyleTitles();
      return;
    }

    document.querySelectorAll('product-card').forEach((card) => {
      if (
        card instanceof HTMLElement &&
        typeof /** @type {{ applyCollectionFilterOptions?: Function }} */ (card)
          .applyCollectionFilterOptions === 'function'
      ) {
        /** @type {{ applyCollectionFilterOptions: Function }} */ (card).applyCollectionFilterOptions({
          color: filters.find((filter) => filter.group === 'color' &&
            VariantMetaobjectStripComponent.#productMatchesFilterValue(card, 'color', filter.value))?.value || '',
          shape: filters.find((filter) => filter.group === 'shape' &&
            VariantMetaobjectStripComponent.#productMatchesFilterValue(card, 'shape', filter.value))?.value || '',
        });
      }
    });

    VariantMetaobjectStripComponent.#enforceCollectionStyleTitles();
  }

  /**
   * Strip leading/trailing metal labels from a collection product title.
   * @param {string} title
   * @returns {string}
   */
  static #stripMetalFromCollectionTitle(title) {
    if (!title) return '';
    let result = String(title).trim();

    result = result
      .replace(
        /^(?:(?:\d+\s*k(?:t)?\s+)?(?:white|yellow|rose|pink)\s+gold|platinum|palladium|sterling\s+silver|silver)\s+/i,
        ''
      )
      .trim();

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
   * Keep collection card titles free of metal labels after async updates.
   * Always rebuild from data-product-title (full title) so Metal filter matching
   * still uses the full title, while the visible line stays clean.
   */
  static #enforceCollectionStyleTitles() {
    document.querySelectorAll('product-card').forEach((card) => {
      if (!(card instanceof HTMLElement)) return;

      const fullTitle = card.dataset.productTitle?.trim() || '';
      const existing = card.dataset.productStyleTitle?.trim() || '';
      const visible =
        card.querySelector('[ref="productCardTitle"]')?.textContent?.trim() || '';
      const next = VariantMetaobjectStripComponent.#stripMetalFromCollectionTitle(
        fullTitle || existing || visible
      );

      if (!next) return;
      card.dataset.productStyleTitle = next;

      const titleEl =
        card.querySelector('[ref="productCardTitle"]') ||
        card.querySelector('[ref="productTitleLink"] [role="heading"]') ||
        card.querySelector('[ref="productTitleLink"] p');
      if (titleEl instanceof HTMLElement && titleEl.textContent?.trim() !== next) {
        titleEl.textContent = next;
      }

      const titleLink = card.querySelector('[ref="productTitleLink"]');
      if (titleLink instanceof HTMLElement) {
        titleLink.dataset.productBaseTitle = next;
      }
    });
  }

  static async applyCollectionWideFilter() {
    const activeFilters = VariantMetaobjectStripComponent.#getActiveClientFilters();
    const ctx = VariantMetaobjectStripComponent.#getSectionContext();

    if (activeFilters.length === 0) {
      const grid = document.querySelector('[ref="grid"], .product-grid');
      if (grid instanceof HTMLElement && grid.dataset.vmFilterMode === 'true') {
        const url = new URL(window.location.href);
        url.searchParams.delete('vm_shape');
        url.searchParams.delete('vm_color');
        url.searchParams.delete('page');
        window.location.assign(url.toString());
      } else {
        VariantMetaobjectStripComponent.applyClientFiltersFromDom();
      }
      return;
    }

    if (!ctx) {
      VariantMetaobjectStripComponent.applyClientFiltersFromDom();
      return;
    }

    const cacheKey = `${window.location.pathname}|${JSON.stringify(activeFilters)}`;
    const page = parseInt(new URL(window.location.href).searchParams.get('page') || '1', 10) || 1;

    // Cache hit with completed data — just re-render.
    if (
      VariantMetaobjectStripComponent.#filterCacheKey === cacheKey &&
      !VariantMetaobjectStripComponent.#fetchPromise
    ) {
      VariantMetaobjectStripComponent.#renderFilteredPage(page);
      return;
    }

    // If same key is already fetching, wait for it then render.
    if (
      VariantMetaobjectStripComponent.#filterCacheKey === cacheKey &&
      VariantMetaobjectStripComponent.#fetchPromise
    ) {
      ctx.container.setAttribute('data-vm-filter-loading', 'true');
      try {
        const matched = await VariantMetaobjectStripComponent.#fetchPromise;
        if (VariantMetaobjectStripComponent.#filterCacheKey === cacheKey && matched) {
          VariantMetaobjectStripComponent.#filteredItemsCache = matched;
          VariantMetaobjectStripComponent.#renderFilteredPage(page);
        }
      } catch {
        /* ignore — newer request will handle */
      }
      return;
    }

    // Bump generation so any in-flight older fetch is ignored when it finishes.
    const generation = ++VariantMetaobjectStripComponent.#applyGeneration;
    VariantMetaobjectStripComponent.#filterCacheKey = cacheKey;
    ctx.container.setAttribute('data-vm-filter-loading', 'true');

    // Disable strip clicks while fetching to avoid stacked races.
    document.querySelectorAll('variant-metaobject-strip-component').forEach((strip) => {
      if (strip instanceof HTMLElement) strip.style.pointerEvents = 'none';
    });

    const fetchPromise = VariantMetaobjectStripComponent.#fetchAllFilteredItems(
      ctx,
      activeFilters,
      generation
    );
    VariantMetaobjectStripComponent.#fetchPromise = fetchPromise;

    try {
      const matched = await fetchPromise;

      // A newer click started another apply — abandon this one.
      if (generation !== VariantMetaobjectStripComponent.#applyGeneration) return;

      VariantMetaobjectStripComponent.#filteredItemsCache = matched;
      VariantMetaobjectStripComponent.#renderFilteredPage(page);
    } catch (error) {
      if (generation === VariantMetaobjectStripComponent.#applyGeneration) {
        console.error('[variant-metaobject] filter failed', error);
        ctx.container.removeAttribute('data-vm-filter-loading');
      }
    } finally {
      if (VariantMetaobjectStripComponent.#fetchPromise === fetchPromise) {
        VariantMetaobjectStripComponent.#fetchPromise = null;
      }
      if (generation === VariantMetaobjectStripComponent.#applyGeneration) {
        document.querySelectorAll('variant-metaobject-strip-component').forEach((strip) => {
          if (strip instanceof HTMLElement) strip.style.pointerEvents = '';
        });
      }
    }
  }

  static #ensureGridObserver() {
    if (VariantMetaobjectStripComponent.#gridObserver) return;

    const root =
      document.querySelector('results-list') ||
      document.querySelector('.product-grid') ||
      document.querySelector('.collection-wrapper');

    if (!root) return;

    VariantMetaobjectStripComponent.#gridObserver = new MutationObserver((mutations) => {
      if (VariantMetaobjectStripComponent.#isApplying) return;

      const grid = document.querySelector('[ref="grid"], .product-grid');
      if (grid instanceof HTMLElement && grid.dataset.vmFilterMode === 'true') return;

      const hasStructuralChange = mutations.some(
        (m) =>
          m.type === 'childList' &&
          [...m.addedNodes, ...m.removedNodes].some(
            (n) =>
              n instanceof Element &&
              (n.matches?.('product-card, .product-grid__item, li') ||
                n.querySelector?.('product-card, .product-grid__item'))
          )
      );
      if (!hasStructuralChange) return;

      if (VariantMetaobjectStripComponent.#observerDebounce) {
        clearTimeout(VariantMetaobjectStripComponent.#observerDebounce);
      }
      VariantMetaobjectStripComponent.#observerDebounce = window.setTimeout(() => {
        VariantMetaobjectStripComponent.applyClientFiltersFromDom();
      }, 30);
    });
    VariantMetaobjectStripComponent.#gridObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  /** Restore active UI from URL (survives facet section re-renders). */
  static syncActiveStateFromUrl() {
    const url = new URL(window.location.href);
    const wanted = {
      shape: (url.searchParams.get('vm_shape') || '').split(',').filter(Boolean),
      color: (url.searchParams.get('vm_color') || '').split(',').filter(Boolean),
    };

    document
      .querySelectorAll('variant-metaobject-strip-component')
      .forEach((strip) => {
        if (!(strip instanceof HTMLElement)) return;

        const activeLabels = [];
        strip.querySelectorAll('[data-strip-filter]').forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const group = el.dataset.filterGroup || '';
          if (group !== 'shape' && group !== 'color') return;

          const value = el.dataset.filterValue || '';
          const active =
            wanted[group].some((selected) =>
              VariantMetaobjectStripComponent.#normalize(value) ===
              VariantMetaobjectStripComponent.#normalize(selected)
            );

          el.dataset.filterActive = active ? 'true' : 'false';
          el.classList.toggle('variant-metaobject-strip__link--active', active);
          if (active) {
            el.setAttribute('aria-current', 'true');
            activeLabels.push(el.dataset.label || value);
          } else {
            el.removeAttribute('aria-current');
          }
        });

        const activeLabel = activeLabels.join(', ') || strip.dataset.allLabel || 'All';
        strip.dataset.defaultLabel = activeLabel;
        const labelEl = strip.querySelector('.variant-metaobject-strip__heading .all');
        if (labelEl instanceof HTMLElement) {
          labelEl.textContent = activeLabel;
        }
        if (strip instanceof VariantMetaobjectStripComponent) {
          strip.#defaultLabel = activeLabel;
        }
      });
    VariantMetaobjectStripComponent.#syncSelectedFilters();
  }

  static #syncSelectedFilters() {
    document.querySelectorAll('[data-vm-selected-filters]').forEach((container) => {
      if (!(container instanceof HTMLElement)) return;
      const form = container.closest('facets-form-component');
      if (!form) return;
      const selections = form.querySelectorAll('[data-strip-filter][data-filter-active="true"]');
      const signature = JSON.stringify([window.location.search, [...selections].map((item) => item.getAttribute('data-label'))]);
      if (container.dataset.selectionSignature === signature) return;
      container.dataset.selectionSignature = signature;
      const fragment = document.createDocumentFragment();
      for (const item of selections) {
        if (!(item instanceof HTMLElement)) continue;
        const key = item.dataset.filterGroup === 'shape' ? 'vm_shape' : 'vm_color';
        const url = new URL(window.location.href);
        const values = (url.searchParams.get(key) || '').split(',')
          .filter((value) => value && value !== item.dataset.filterValue);
        url.searchParams.delete(key);
        url.searchParams.delete('page');
        if (values.length) url.searchParams.set(key, values.join(','));
        const remove = document.createElement('facet-remove-component');
        remove.dataset.url = url.toString();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button-unstyled variant-metaobject-selected__remove';
        button.setAttribute('on:click', '/removeFilter?form=');
        const label = item.dataset.label || item.dataset.filterValue || '';
        button.append(document.createTextNode(label));
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = ' ×';
        button.append(icon);
        const accessible = document.createElement('span');
        accessible.className = 'visually-hidden';
        accessible.textContent = ' ' + (container.dataset.removeLabel || '');
        button.append(accessible);
        remove.append(button);
        fragment.append(remove);
      }
      container.replaceChildren(fragment);
      container.hidden = selections.length === 0;
    });
  }

  static applyClientFiltersFromDom() {
    const activeFilters = VariantMetaobjectStripComponent.#getActiveClientFilters();
    const grid = document.querySelector('[ref="grid"], .product-grid');

    if (activeFilters.length > 0) {
      // Delegate to the single-flight collection-wide path.
      VariantMetaobjectStripComponent.applyCollectionWideFilter();
      return;
    }

    if (grid instanceof HTMLElement && grid.dataset.vmFilterMode === 'true') {
      return;
    }

    VariantMetaobjectStripComponent.#isApplying = true;

    try {
      const cards = document.querySelectorAll('product-card');
      /** @type {Set<string>} */
      const seenGroups = new Set();

      cards.forEach((card) => {
        if (!(card instanceof HTMLElement)) return;
        const item =
          card.closest('.product-grid__item') || card.closest('li') || card;

        if (!(item instanceof HTMLElement)) return;

        const group =
          (card.dataset.productGroup || item.dataset.productGroup || '').trim();
        let hideAsDuplicate = false;

        if (group) {
          const key = VariantMetaobjectStripComponent.#normalize(group);
          if (seenGroups.has(key)) {
            hideAsDuplicate = true;
          } else {
            seenGroups.add(key);
          }
        }

        if (hideAsDuplicate) {
          item.hidden = true;
          item.dataset.groupDuplicate = 'true';
          item.classList.add('product-grid__item--group-duplicate');
          item.setAttribute('data-vm-filtered-out', 'true');
        } else {
          item.hidden = false;
          item.style.removeProperty('display');
          item.removeAttribute('data-vm-filtered-out');
          item.removeAttribute('data-group-duplicate');
          item.classList.remove('product-grid__item--group-duplicate');
        }
      });
    } finally {
      VariantMetaobjectStripComponent.#isApplying = false;
    }
  }

  static invalidateFilterCache() {
    VariantMetaobjectStripComponent.#filterCacheKey = '';
    VariantMetaobjectStripComponent.#applyGeneration += 1;
    VariantMetaobjectStripComponent.#fetchPromise = null;
  }

  /**
   * @param {number} [pageNum]
   */
  static renderFilteredPage(pageNum) {
    VariantMetaobjectStripComponent.#renderFilteredPage(pageNum);
  }

  /**
   * @param {string} text
   */
  #setLabel(text) {
    const labelEl =
      this.refs.labelEl || this.querySelector('.variant-metaobject-strip__heading .all');
    if (labelEl instanceof HTMLElement) {
      labelEl.textContent = text;
    }
  }
}

if (!customElements.get('variant-metaobject-strip-component')) {
  customElements.define('variant-metaobject-strip-component', VariantMetaobjectStripComponent);
}

document.addEventListener(ThemeEvents.FilterUpdate, () => {
  // Price/native facets remorph the section. Re-apply vm_* afterward without
  // clearing an in-progress Metal/Shape fetch (that race wiped results).
  const hasVm =
    new URL(window.location.href).searchParams.has('vm_color') ||
    new URL(window.location.href).searchParams.has('vm_shape');
  if (!hasVm) return;
  VariantMetaobjectStripComponent.scheduleApplyClientFilters();
});

document.addEventListener('variant-metaobject:reapply', () => {
  VariantMetaobjectStripComponent.syncActiveStateFromUrl();
});

/**
 * Pagination: client-side when vm_* filter active, otherwise preserve vm_* in URL.
 */
document.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a.pagination__link[href]');
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.getAttribute('aria-disabled') === 'true') return;
    if (link.classList.contains('pagination__link--disabled')) return;

    const current = new URL(window.location.href);
    const shape = current.searchParams.get('vm_shape');
    const color = current.searchParams.get('vm_color');
    const vmActive = Boolean(shape || color);
    const grid = document.querySelector('[ref="grid"], .product-grid');
    const inFilterMode = grid instanceof HTMLElement && grid.dataset.vmFilterMode === 'true';

    if (vmActive && inFilterMode) {
      event.preventDefault();
      const next = new URL(link.href, window.location.origin);
      const page = parseInt(next.searchParams.get('page') || '1', 10) || 1;
      if (shape) current.searchParams.set('vm_shape', shape);
      if (color) current.searchParams.set('vm_color', color);
      if (page > 1) {
        current.searchParams.set('page', String(page));
      } else {
        current.searchParams.delete('page');
      }
      history.replaceState(history.state, '', current.toString());
      VariantMetaobjectStripComponent.renderFilteredPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!vmActive) return;

    const next = new URL(link.href, window.location.origin);
    let changed = false;
    if (shape && next.searchParams.get('vm_shape') !== shape) {
      next.searchParams.set('vm_shape', shape);
      changed = true;
    }
    if (color && next.searchParams.get('vm_color') !== color) {
      next.searchParams.set('vm_color', color);
      changed = true;
    }
    if (!changed) return;

    event.preventDefault();
    window.location.assign(next.toString());
  },
  true
);

/** Re-apply Metal/Shape filters once the product grid is available. */
const runVariantMetaobjectClientFilters = () => {
  VariantMetaobjectStripComponent.syncActiveStateFromUrl();
  VariantMetaobjectStripComponent.applyCollectionWideFilter();
  // Initial paint: sync swatches even before collection-wide fetch finishes / when SSR already filtered.
  requestAnimationFrame(() => {
    VariantMetaobjectStripComponent.syncProductCardsToActiveFilters();
  });
  // Late variant morphs can reintroduce metal into titles — re-enforce after they settle.
  window.setTimeout(() => {
    VariantMetaobjectStripComponent.syncProductCardsToActiveFilters();
  }, 800);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runVariantMetaobjectClientFilters, { once: true });
} else {
  runVariantMetaobjectClientFilters();
}

window.addEventListener('popstate', () => {
  VariantMetaobjectStripComponent.invalidateFilterCache();
  VariantMetaobjectStripComponent.syncActiveStateFromUrl();
  VariantMetaobjectStripComponent.applyCollectionWideFilter();
});

