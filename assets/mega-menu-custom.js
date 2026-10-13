/**
 * Injects Header mega menu panel stores into matching nav items.
 * Horizon static header Menu liquid cannot read section.blocks for panels.
 */

/**
 * Known locale / market path prefixes to strip when reading URL handles.
 * @param {string[]} parts
 * @returns {string[]}
 */
function stripLocalePathParts(parts) {
  if (!parts.length) return parts;
  const first = parts[0].toLowerCase();
  // ISO language (de, fr) or language-region (pt-br, zh-tw)
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(first)) {
    return parts.slice(1);
  }
  return parts;
}

/**
 * @param {string} href
 * @returns {string}
 */
function getCollectionHandleFromHref(href) {
  if (!href) return '';
  try {
    const url = new URL(href, window.location.origin);
    const parts = stripLocalePathParts(url.pathname.split('/').filter(Boolean));
    const collectionsIndex = parts.findIndex((part) => part.toLowerCase() === 'collections');
    if (collectionsIndex >= 0 && parts[collectionsIndex + 1]) {
      return parts[collectionsIndex + 1].toLowerCase();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeTitle(value) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * @param {string} value
 * @returns {string}
 */
function handleize(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\u00C0-\u024f]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Split title/handle aliases configured for multilingual menus.
 * @param {string} value
 * @returns {string[]}
 */
function parseAliases(value) {
  if (!value) return [];
  return value
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @param {string} href
 * @returns {string}
 */
function getPathHandleFromHref(href) {
  if (!href) return '';
  try {
    const url = new URL(href, window.location.origin);
    const parts = stripLocalePathParts(url.pathname.split('/').filter(Boolean));
    return parts.length ? parts[parts.length - 1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * @param {ParentNode | null} root
 * @returns {boolean}
 */
export function panelHasDisplayableContent(root) {
  if (!root) return false;
  if (
    root.querySelector(
      '.mega-menu-custom__item, .mega-menu-column__list > li, .mega-menu-column__heading, .mega-menu-column, .mega-menu-panel-footer, .mega-menu-panel-more'
    )
  ) {
    return true;
  }
  const grid = root.querySelector('.mega-menu__grid--custom, .mega-menu__grid');
  return Boolean(grid?.children.length);
}

/**
 * @typedef {{ id: string, index: number, title: string, handle: string }} MegaPanelMatchConfig
 */

/**
 * Authoritative panel match config from header.liquid (can read section.blocks).
 * @param {ParentNode | null} headerComponent
 * @returns {MegaPanelMatchConfig[]}
 */
function readMegaPanelMatchMap(headerComponent) {
  const script =
    headerComponent?.querySelector('#MegaMenuPanelMatchMap') ||
    document.getElementById('MegaMenuPanelMatchMap');
  if (!(script instanceof HTMLScriptElement)) return [];

  try {
    const parsed = JSON.parse(script.textContent || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id: String(item?.id || ''),
      index: Number(item?.index || 0),
      title: String(item?.title || ''),
      handle: String(item?.handle || ''),
    }));
  } catch {
    return [];
  }
}

/**
 * Sync store data-* attrs from the Liquid match map (source of truth).
 * @param {NodeListOf<Element> | Element[]} stores
 * @param {MegaPanelMatchConfig[]} matchMap
 */
function applyMatchMapToStores(stores, matchMap) {
  if (!matchMap.length) return;

  stores.forEach((store) => {
    if (!(store instanceof HTMLElement)) return;
    const storeId =
      store.dataset.panelBlockId || store.getAttribute('id')?.replace(/^shopify-block-/, '') || '';
    const conf =
      matchMap.find((item) => item.id && item.id === storeId) ||
      matchMap.find((item, index) => {
        // Fallback: map by DOM order when ids are missing
        return !storeId && matchMap.indexOf(item) === [...stores].indexOf(store);
      });

    if (!conf) return;

    if (conf.id) store.dataset.panelBlockId = conf.id;
    if (conf.title) store.dataset.menuTitle = conf.title;
    if (conf.handle) store.dataset.menuHandle = conf.handle;
    if (conf.index > 0) store.dataset.menuItemIndex = String(conf.index);
  });
}

/**
 * Whether it is safe to inject mega panel content now.
 * Custom panels are SSR'd in `.mega-menu-panel-store` — never block on section
 * hydration (localized /de /fr pages may never set data-hydrated).
 * @param {HTMLElement | null} headerComponent
 * @returns {boolean}
 */
function canInjectMegaMenus(headerComponent) {
  if (!headerComponent) return false;

  if (window.Shopify?.designMode) {
    const headerSection = headerComponent.closest('.header-section');
    if (headerSection instanceof HTMLElement) {
      headerSection.dataset.hydrated = 'true';
    }
  }

  return Boolean(headerComponent.querySelector('.mega-menu-panel-store'));
}

/**
 * @param {HTMLElement} listItem
 * @param {boolean} ready
 */
function setMegaMenuReadyState(listItem, ready) {
  if (ready) {
    listItem.dataset.megaReady = 'true';
    delete listItem.dataset.megaPending;
    const submenu = listItem.querySelector('[ref="submenu[]"]');
    if (submenu instanceof HTMLElement) {
      delete submenu.dataset.megaEmpty;
    }
  } else {
    delete listItem.dataset.megaReady;
    listItem.dataset.megaPending = 'true';
  }
}

/**
 * @param {HTMLElement} headerMenu
 * @param {HTMLElement | null} headerComponent
 */
function syncMegaMenuDebug(headerMenu, headerComponent) {
  const stores = headerComponent?.querySelectorAll('.mega-menu-panel-store') ?? [];
  const storeCount = stores.length;

  let panelIds =
    headerComponent?.dataset.megaPanelIds ||
    headerComponent?.querySelector('.header-section__mega-blocks-registry')?.dataset.megaPanelIds ||
    '';

  if (!panelIds && storeCount > 0) {
    panelIds = [...stores]
      .map(
        (store) =>
          (store instanceof HTMLElement && store.dataset.panelBlockId) ||
          store.getAttribute('id')?.replace(/^shopify-block-/, '') ||
          ''
      )
      .filter(Boolean)
      .join(',');
  }

  let panelCount = Number(headerComponent?.dataset.megaPanelCount ?? 0);
  if (storeCount > 0 && panelCount === 0) {
    panelCount = storeCount;
    if (headerComponent instanceof HTMLElement) {
      headerComponent.dataset.megaPanelCount = String(storeCount);
      if (panelIds) {
        headerComponent.dataset.megaPanelIds = panelIds;
      }
    }
  }

  const storeIndexSummary = [...stores]
    .map((store) => {
      if (!(store instanceof HTMLElement)) return '';
      return `${store.dataset.panelBlockId || '?'}:${store.dataset.menuItemIndex || 0}`;
    })
    .filter(Boolean)
    .join(',');

  headerMenu.dataset.megaDebugStoreCount = String(storeCount);
  headerMenu.dataset.megaDebugPanelCount = String(panelCount);
  headerMenu.dataset.megaDebugStoreIndexes = storeIndexSummary;

  headerMenu.querySelectorAll('.menu-list__list-item[data-nav-index]').forEach((li) => {
    if (li instanceof HTMLElement) {
      li.dataset.megaDebugIds = panelIds;
      li.dataset.megaDebugPanelCount = String(panelCount);
      li.dataset.megaDebugStoreCount = String(storeCount);
      li.dataset.megaDebugStoreIndexes = storeIndexSummary;

      if (storeCount === 0 && panelCount === 0) {
        li.dataset.megaDebugNote = 'no-panel-add-under-header-section';
      } else if (li.dataset.megaJsMatched === 'true') {
        li.dataset.megaDebugNote = 'js-matched-ok';
        li.dataset.megaDebugMatched = 'yes';
      } else {
        li.dataset.megaDebugNote = 'panel-exists-check-menu-title-or-handle';
      }
    }
  });
}

/**
 * Collect handleized aliases from title + handle settings.
 * @param {string} titleRaw
 * @param {string} handleRaw
 * @returns {string[]}
 */
function collectMatchKeys(titleRaw, handleRaw) {
  const keys = new Set();
  for (const alias of [...parseAliases(titleRaw), ...parseAliases(handleRaw)]) {
    const normalized = normalizeTitle(alias);
    const asHandle = handleize(alias);
    if (normalized) keys.add(normalized);
    if (asHandle) keys.add(asHandle);
  }
  return [...keys];
}

/**
 * @param {string} storeHandleRaw
 * @param {string} storeTitleRaw
 * @param {number} storeItemIndex
 * @param {string} href
 * @param {string} linkTitle
 * @param {string} linkId
 * @param {number} linkIndex
 * @param {string} [storePanelId]
 * @param {string} [listPanelId]
 * @param {string} [navHandle]
 * @returns {boolean}
 */
function isMegaMenuLinkMatch(
  storeHandleRaw,
  storeTitleRaw,
  storeItemIndex,
  href,
  linkTitle,
  linkId,
  linkIndex,
  storePanelId = '',
  listPanelId = '',
  navHandle = ''
) {
  // Liquid already bound this nav item to this panel store
  if (storePanelId && listPanelId && storePanelId === listPanelId) {
    return true;
  }

  // Stable across locales: data-nav-handle stays "engagement-rings" even when title is translated
  if (storeItemIndex > 0 && storeItemIndex === linkIndex) {
    return true;
  }

  const matchKeys = collectMatchKeys(storeTitleRaw, storeHandleRaw);
  const navHandleKey = handleize(navHandle);
  if (navHandleKey && matchKeys.includes(navHandleKey)) {
    return true;
  }

  const linkHandle =
    navHandleKey || getCollectionHandleFromHref(href) || getPathHandleFromHref(href);
  const normalizedLinkTitle = normalizeTitle(linkTitle);
  const linkTitleHandle = handleize(linkTitle);
  const linkHandleFromId = linkId.startsWith('MenuItem-')
    ? linkId.slice('MenuItem-'.length).toLowerCase()
    : '';

  if (
    (normalizedLinkTitle && matchKeys.includes(normalizedLinkTitle)) ||
    (linkTitleHandle && matchKeys.includes(linkTitleHandle)) ||
    (linkHandle && matchKeys.includes(linkHandle)) ||
    (linkHandleFromId && matchKeys.includes(linkHandleFromId))
  ) {
    return true;
  }

  return false;
}

/**
 * @param {HTMLElement} headerMenu
 */
export function initCustomMegaMenus(headerMenu) {
  const headerComponent = headerMenu.closest('header-component');
  if (!headerComponent) return;

  const stores = headerComponent.querySelectorAll('.mega-menu-panel-store');
  const matchMap = readMegaPanelMatchMap(headerComponent);
  applyMatchMapToStores(stores, matchMap);

  if (!stores.length) {
    syncMegaMenuDebug(headerMenu, headerComponent);
    return;
  }

  if (!canInjectMegaMenus(headerComponent)) {
    headerMenu.querySelectorAll('[data-mega-await-js]').forEach((li) => {
      if (li instanceof HTMLElement) {
        li.dataset.megaPending = 'true';
        delete li.dataset.megaReady;
      }
    });
    syncMegaMenuDebug(headerMenu, headerComponent);
    return;
  }

  // Prefer list items with data-nav-index (stable). Fall back to ref=menuitem.
  const listItems = [...headerMenu.querySelectorAll('.menu-list__list-item[data-nav-index]')];
  const menuEntries = listItems
    .map((listItem, index) => {
      if (!(listItem instanceof HTMLElement)) return null;
      const link =
        listItem.querySelector(':scope > [ref="menuitem"], :scope > .menu-list__link, :scope > a') ||
        listItem.querySelector('[ref="menuitem"]');
      if (!(link instanceof HTMLElement)) return null;
      return { listItem, link, index };
    })
    .filter(Boolean);

  headerMenu.dataset.megaDebugJsVersion = 'nav-handle-v3-no-hydrate';

  stores.forEach((store) => {
    if (!(store instanceof HTMLElement)) return;

    const storeHandleRaw = store.dataset.menuHandle || '';
    const storeTitleRaw = store.dataset.menuTitle || '';
    const storeItemIndex = Number(store.dataset.menuItemIndex || 0);
    const storePanelId = store.dataset.panelBlockId || store.id?.replace(/^shopify-block-/, '') || '';
    const content = store.querySelector('.mega-menu-panel-content');
    const matchKeys = collectMatchKeys(storeTitleRaw, storeHandleRaw);
    store.dataset.megaMatchKeys = matchKeys.join('|');

    if (!content) return;

    menuEntries.forEach((entry) => {
      if (!entry) return;
      const { listItem: listItemForIndex, link, index } = entry;
      const href = link.getAttribute('href') || '';

      const linkTitle =
        listItemForIndex.dataset.navTitle ||
        link.querySelector('.menu-list__link-title')?.textContent ||
        '';
      const linkId = link.id || '';
      const navHandle = listItemForIndex.dataset.navHandle || '';

      // Prefer Liquid-rendered nav index (stable across overflow slot moves).
      const navIndexAttr = Number(listItemForIndex.dataset.navIndex || 0);
      const linkIndex = navIndexAttr > 0 ? navIndexAttr : index + 1;
      const listPanelId = listItemForIndex.dataset.megaPanelId || '';

      const isMatch = isMegaMenuLinkMatch(
        storeHandleRaw,
        storeTitleRaw,
        storeItemIndex,
        href,
        linkTitle,
        linkId,
        linkIndex,
        storePanelId,
        listPanelId,
        navHandle
      );

      listItemForIndex.dataset.megaDebugNavHandle = navHandle || '';
      listItemForIndex.dataset.megaDebugMatchKeys = matchKeys.join('|');

      if (!isMatch) return;

      const listItem = listItemForIndex;
      const navHandleKey = handleize(navHandle);
      const matchedBy =
        storeItemIndex > 0 && storeItemIndex === linkIndex
          ? 'index'
          : navHandleKey && matchKeys.includes(navHandleKey)
            ? 'nav-handle'
            : 'title-or-handle';

      listItem.dataset.megaPanelMatched = 'true';
      listItem.dataset.megaDebugMatched = 'yes';
      listItem.dataset.megaJsMatched = 'true';
      delete listItem.dataset.megaAwaitJs;
      listItem.dataset.megaMatchedBy = matchedBy;

      let submenu = listItem.querySelector('[ref="submenu[]"]');
      // 只要面板内容已在 DOM 中就绝不重建，避免拆掉用户正在悬停/点击的 <a>
      const alreadyInjected = Boolean(submenu?.querySelector('.mega-menu-panel-content'));

      if (alreadyInjected) {
        listItem.dataset.megaJsMatched = 'true';
        delete listItem.dataset.megaAwaitJs;
        if (storePanelId) listItem.dataset.megaInjected = storePanelId;
        const hasContent = panelHasDisplayableContent(listItem);
        setMegaMenuReadyState(listItem, hasContent);
        return;
      }

      const clonedContent = /** @type {HTMLElement} */ (content.cloneNode(true));
      const storeColumns = Math.max(1, Number(store.dataset.columns || 4));
      const storeHandleId = handleize(
        parseAliases(storeTitleRaw)[0] ||
          parseAliases(storeHandleRaw)[0] ||
          linkTitle ||
          href ||
          String(index)
      );
      const contentAlign = (
        store.dataset.contentAlign ||
        clonedContent.dataset.contentAlign ||
        'center'
      ).toLowerCase();
      const contentWidth = Number(
        store.dataset.contentWidth ||
          String(clonedContent.style.getPropertyValue('--mega-menu-panel-content-width') || '').replace('px', '') ||
          1220
      );
      const columnsJustify =
        contentAlign === 'left' ? 'flex-start' : contentAlign === 'right' ? 'flex-end' : 'center';
      const panelMarginInline =
        contentAlign === 'left' ? '0 auto' : contentAlign === 'right' ? 'auto 0' : 'auto';

      // 写入版心变量；max-width 用 min() 保证窄于设置宽度时不溢出
      clonedContent.dataset.contentAlign = contentAlign;
      clonedContent.classList.remove(
        'mega-menu-panel-content--align-left',
        'mega-menu-panel-content--align-center',
        'mega-menu-panel-content--align-right'
      );
      clonedContent.classList.add(`mega-menu-panel-content--align-${contentAlign}`);
      clonedContent.style.setProperty('--mega-menu-panel-content-width', `${contentWidth}px`);
      clonedContent.style.setProperty('--mega-menu-columns-justify', columnsJustify);
      clonedContent.style.setProperty('--mega-menu-panel-margin-inline', panelMarginInline);
      clonedContent.style.setProperty('max-width', `min(${contentWidth}px, 100%)`, 'important');
      clonedContent.style.setProperty('width', '100%', 'important');
      clonedContent.style.setProperty('margin-inline', panelMarginInline, 'important');
      clonedContent.style.setProperty('display', 'block', 'important');
      clonedContent.style.setProperty('box-sizing', 'border-box', 'important');

      const clonedColumns = clonedContent.querySelector('.mega-menu-columns');
      if (clonedColumns instanceof HTMLElement) {
        clonedColumns.style.setProperty('display', 'flex', 'important');
        clonedColumns.style.setProperty('flex-wrap', 'nowrap', 'important');
        clonedColumns.style.setProperty('justify-content', columnsJustify, 'important');
        clonedColumns.style.setProperty('width', '100%', 'important');
        clonedColumns.style.setProperty('max-width', '100%', 'important');
      }

      if (!submenu) {
        submenu = document.createElement('div');
        submenu.className = 'menu-list__submenu';
        submenu.setAttribute('ref', 'submenu[]');
        submenu.dataset.megaStore = storeHandleId;

        const inner = document.createElement('div');
        inner.className = 'menu-list__submenu-inner';
        inner.id = `submenu-custom-${storeHandleId || index + 1}`;
        inner.dataset.megaStore = storeHandleId;

        inner.appendChild(clonedContent);
        submenu.appendChild(inner);
        listItem.appendChild(submenu);

        link.setAttribute('aria-haspopup', 'true');
        link.setAttribute('aria-expanded', 'false');
        link.setAttribute('aria-controls', inner.id);
      } else {
        // Always inject full panel-content so width/align settings are preserved
        const inner = submenu.querySelector('.menu-list__submenu-inner');
        if (inner) {
          inner.innerHTML = '';
          inner.appendChild(clonedContent);
        }
      }

      const targetContent = submenu instanceof HTMLElement ? submenu : clonedContent;
      const innerRoot = targetContent.querySelector('.menu-list__submenu-inner') || targetContent;
      const rootGrid = innerRoot.querySelector('.mega-menu__grid');
      // Only force card-grid layout for non-columns mega menus
      if (
        rootGrid instanceof HTMLElement &&
        !rootGrid.classList.contains('mega-menu__grid--columns')
      ) {
        rootGrid.style.setProperty('display', 'grid', 'important');
        rootGrid.style.setProperty(
          'grid-template-columns',
          `repeat(${storeColumns}, minmax(0, 1fr))`,
          'important'
        );
        rootGrid.style.setProperty('gap', 'clamp(16px, 2.352941vw, 32px)', 'important');
        rootGrid.style.setProperty('align-items', 'start', 'important');
      }

      innerRoot.querySelectorAll('.mega-menu-column').forEach((column) => {
        if (column instanceof HTMLElement) {
          column.style.setProperty('display', 'flex', 'important');
          column.style.setProperty('flex', '1 1 0', 'important');
          column.style.setProperty('flex-direction', 'column', 'important');
          column.style.setProperty('width', 'auto', 'important');
          column.style.setProperty('max-width', 'var(--mega-menu-column-width, 320px)', 'important');
          column.style.setProperty('min-width', '0', 'important');
          column.style.setProperty('overflow', 'visible', 'important');
          column.style.setProperty('pointer-events', 'auto', 'important');
        }
      });

      const liveColumns = innerRoot.querySelector('.mega-menu-columns');
      if (liveColumns instanceof HTMLElement) {
        liveColumns.style.setProperty('display', 'flex', 'important');
        liveColumns.style.setProperty('flex-wrap', 'nowrap', 'important');
        liveColumns.style.setProperty('justify-content', columnsJustify, 'important');
        liveColumns.style.setProperty('width', '100%', 'important');
        liveColumns.style.setProperty('max-width', '100%', 'important');
      }

      innerRoot.querySelectorAll('.mega-menu-column__heading').forEach((heading) => {
        if (heading instanceof HTMLElement) {
          heading.style.setProperty('display', 'block', 'important');
          heading.style.setProperty('position', 'relative', 'important');
          heading.style.setProperty('z-index', '3', 'important');
          heading.style.setProperty('white-space', 'normal', 'important');
          heading.style.setProperty('margin', '0 0 clamp(12px, 1.7647058vw, 24px)', 'important');
        }
      });

      innerRoot.querySelectorAll('.mega-menu-column__list').forEach((list) => {
        if (list instanceof HTMLElement) {
          const subCols = Number(list.dataset.subColumns || 2);
          list.style.setProperty('display', 'grid', 'important');
          list.style.setProperty('grid-template-columns', `repeat(${Math.max(1, subCols)}, minmax(0, 1fr))`, 'important');
          list.style.setProperty('column-gap', 'clamp(12px, 1.1764705vw, 16px)', 'important');
          list.style.setProperty('row-gap', 'clamp(10px, 0.8823529vw, 12px)', 'important');
          list.style.setProperty('min-width', '0', 'important');
          list.style.setProperty('margin', '0', 'important');
          list.style.setProperty('padding', '0', 'important');
        }
      });

      innerRoot.querySelectorAll('.mega-menu-custom__item').forEach((item) => {
        if (item instanceof HTMLElement) {
          item.style.setProperty('display', 'block', 'important');
          item.style.setProperty('position', 'relative', 'important');
          item.style.setProperty('overflow', 'visible', 'important');
          item.style.setProperty('pointer-events', 'auto', 'important');
          item.style.setProperty('z-index', '2', 'important');
        }
      });

      innerRoot.querySelectorAll('.mega-menu-custom__link').forEach((linkEl) => {
        if (linkEl instanceof HTMLElement) {
          linkEl.style.setProperty('pointer-events', 'auto', 'important');
          linkEl.style.setProperty('position', 'relative', 'important');
          linkEl.style.setProperty('z-index', '5', 'important');
        }
      });

      const hasContent =
        panelHasDisplayableContent(listItem) || panelHasDisplayableContent(clonedContent);
      setMegaMenuReadyState(listItem, hasContent);

      if (hasContent && submenu instanceof HTMLElement) {
        submenu.removeAttribute('hidden');
        listItem.dataset.megaInjected = storePanelId;
      }
    });
  });

  syncMegaMenuDebug(headerMenu, headerComponent);
}

/**
 * Ensure injected mega menu images load and submenu is measurable.
 * @param {HTMLElement} listItem
 */
function activateMegaMenuImages(listItem) {
  const submenu = listItem.querySelector('[ref="submenu[]"]');
  if (!submenu) return;

  submenu.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('loading');
    if (img.dataset.src && !img.src) {
      img.src = img.dataset.src;
    }
  });

  const itemCount = submenu.querySelectorAll('.mega-menu-custom__item').length;
  const columnCount = submenu.querySelectorAll('.mega-menu-column').length;
  listItem.dataset.megaItemCount = String(itemCount);
  if (columnCount > 0) {
    listItem.dataset.megaLayout = 'columns';
    listItem.dataset.megaColumnCount = String(columnCount);
  }
}
