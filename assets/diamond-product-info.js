(function () {
  'use strict';

  //愿望清单
  // ===== WISHLIST =====
const WISHLIST_KEY = 'ecglosty_wishlist';

function dpiGetWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.diamonds)) return parsed;
    }
  } catch(e) {}
  return { diamonds: [], others: [] };
}

function dpiSaveWishlist(wl) {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(wl));
}

function dpiGetDiamondKey(d) {
  return d.id || d.sku || d.productId || d.urlHandle;
}

function dpiIsWishlisted(d) {
  const wl = dpiGetWishlist();
  const key = dpiGetDiamondKey(d);
  return wl.diamonds.some(item => dpiGetDiamondKey(item) === key);
}

function dpiToggleWishlist() {
  if (!currentProductData) return;

  const wl = dpiGetWishlist();
  const key = dpiGetDiamondKey(currentProductData);
  const existingIdx = wl.diamonds.findIndex(item => dpiGetDiamondKey(item) === key);

  if (existingIdx >= 0) {
    wl.diamonds.splice(existingIdx, 1);
  } else {
    // 合并操作：外层属性 + attribute内属性，排除原attribute字段
    const keysToCopy = ['shape', 'carat', 'color','fancyColor', 'clarity', 'cut','pol','symm','flo','lab','diamondLength','diamondWidth','diamondHeight','depth','diamondTable','pricePerCarat','pdf','medias'];
    const transformedData = mergePartialAttributes(currentProductData,keysToCopy);
    wl.diamonds.push(transformedData);
  }

  dpiSaveWishlist(wl);
  dpiSyncWishlistBtn();
}

function dpiSyncWishlistBtn() {
  const btn = document.querySelector('.dpi-btn--wishlist');
  if (!btn) return;
  const wishlisted = currentProductData && dpiIsWishlisted(currentProductData);
  btn.classList.toggle('wishlisted', !!wishlisted);
  const textNode = btn.childNodes[btn.childNodes.length - 1];
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    textNode.textContent = wishlisted ? ' WISHLISTED' : ' ADD TO WISHLIST';
  }
}

  //end 愿望清单

  const section = document.querySelector('.dpi-section');
  if (!section) return;

  // ── Config ──────────────────────────────────────────────────────────────
  const PRODUCT_ID    = section.dataset.productId;
  const SHOP_DOMAIN   = "https://"+section.dataset.shopDomain;
  const API_BASE      = (section.dataset.apiEndpoint || '').replace(/\/$/, '');


  // ── DOM refs ─────────────────────────────────────────────────────────────
  const thumbsEl       = document.getElementById('dpi-thumbnails');
  const mainMediaEl    = document.getElementById('dpi-main-media');

const diamondReportEl  = document.getElementById('dpi-diamond-report');

  const diamondCaratEl=document.getElementById('dpi-diamond-carat');
const diamondColorEl=document.getElementById('dpi-diamond-color');
const diamondCutEl=document.getElementById('dpi-diamond-cut');
const diamondClarityEl=document.getElementById('dpi-diamond-clarity');
const diamondSkuEl=document.getElementById('dpi-diamond-sku');
const diamondSymmetryEl=document.getElementById('dpi-diamond-symmetry');
const diamondMeasurementsEl=document.getElementById('dpi-diamond-measurements');
const diamondPolishEl=document.getElementById('dpi-diamond-polish');


  const totalPriceEl   = document.getElementById('dpi-total-price');
  const stockStatusEl  = document.getElementById('dpi-stock-status');
  const chooseBtnEl    = document.getElementById('dpi-choose-btn');
  const shipDateEl     = document.getElementById('dpi-ship-date');

  // Lightbox
  const lightbox        = document.getElementById('dpi-lightbox');
  const lightboxImg     = document.getElementById('dpi-lightbox-img');
  const lightboxClose   = document.getElementById('dpi-lightbox-close');
  const lightboxOverlay = document.getElementById('dpi-lightbox-overlay');

  // 3D modal
  const modelModal        = document.getElementById('dpi-model-modal');
  const modelViewer       = document.getElementById('dpi-model-viewer');
  const modelModalClose   = document.getElementById('dpi-model-modal-close');
  const modelModalOverlay = document.getElementById('dpi-model-modal-overlay');
  let currentProductData = null;
  let currentSortedMedias = [];   // 存储当前排序后的媒体，供 resize 复用


  // ── Shipping date (10 business days) ────────────────────────────────────
  function calcShipDate() {
    const d = new Date();
    let added = 0;
    while (added < 10) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) added++;
    }
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (shipDateEl) shipDateEl.textContent = calcShipDate();

  // ── Money formatter ──────────────────────────────────────────────────────
  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ── Lightbox ─────────────────────────────────────────────────────────────
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add('open');
  }
  lightboxClose.addEventListener('click', () => lightbox.classList.remove('open'));
  lightboxOverlay.addEventListener('click', () => lightbox.classList.remove('open'));
  //3D旋转重构销毁的步骤
  const dpiSpinInstances = new Set();
  let dpiMediaMode = null;

  function dpiCreateSpinLifecycle(canvas) {
    const controller = new AbortController();
    const images = new Set();
    const timers = new Set();

    let disposed = false;
    let rafId = null;

    const lifecycle = {
      get disposed() {
        return disposed;
      },

      trackImage(img) {
        images.add(img);
        return img;
      },

      listen(target, type, handler, options = {}) {
        target.addEventListener(type, handler, {
          ...options,
          signal: controller.signal
        });
      },

      requestFrame(callback) {
        if (disposed) return;

        rafId = requestAnimationFrame(now => {
          rafId = null;
          if (disposed) return;

          if (!section.isConnected || !canvas.isConnected) {
            lifecycle.destroy();
            return;
          }

          callback(now);
        });
      },

      delay(callback, milliseconds) {
        if (disposed) return;

        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!disposed) callback();
        }, milliseconds);

        timers.add(timer);
      },

      destroy() {
        if (disposed) return;
        disposed = true;

        if (rafId !== null) cancelAnimationFrame(rafId);
        controller.abort();

        for (const timer of timers) clearTimeout(timer);
        timers.clear();

        for (const img of images) {
          img.onload = null;
          img.onerror = null;
          img.removeAttribute('src');
        }
        images.clear();

        canvas.width = 1;
        canvas.height = 1;

        dpiSpinInstances.delete(lifecycle);
      }
    };

    dpiSpinInstances.add(lifecycle);
    return lifecycle;
  }

  function dpiDestroySpins() {
    for (const instance of [...dpiSpinInstances]) {
      instance.destroy();
    }
  }

  function dpiRemoveMobileCarousel() {
    section.querySelector('.dpi-carousel-main')?.remove();
    section.querySelector('.dpi-carousel-thumbs')?.remove();
  }

  //end 3D旋转重构销毁的步骤
  // ── 3D Model modal ───────────────────────────────────────────────────────
  function openModelModal(src) {
    modelViewer.setAttribute('src', src);
    modelModal.classList.add('open');
  }
  modelModalClose.addEventListener('click', () => modelModal.classList.remove('open'));
  modelModalOverlay.addEventListener('click', () => modelModal.classList.remove('open'));

// ── DOM ref (新) ──────────────────────────────────────────────────────────
const mediaGridEl = document.getElementById('dpi-media-grid');

// ── 判断是否是人物/场景图（非白底产品图）────────────────────────────────
// 根据 sortOrder 或 extraInfo 判断，这里简单用 index >= 4 作为场景图
function isPortraitMedia(index) {
  return index >= 4;
}

// ── 创建媒体容器 ──────────────────────────────────────────────────────────
function createMediaItem(index, extraClasses) {
  const item = document.createElement('div');
  item.className = 'dpi-media-item' + (extraClasses ? ' ' + extraClasses : '');
  if (isPortraitMedia(index)) {
    item.classList.add('dpi-media-item--portrait');
  }
  return item;
}
//画廊
// ── mediaType 6 — Popular Pairings ───────────────────────────────────────
function dpiPairingIsVideo(url) {
  try {
    return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(
      new URL(url, window.location.href).pathname
    );
  } catch (_) {
    return false;
  }
}

function dpiPairingResources(media) {
  if (!Array.isArray(media?.extraInfo)) return [];

  return media.extraInfo
    .filter(resource =>
      resource &&
      typeof resource.url === 'string' &&
      resource.url.trim()
    )
    .map(resource => ({
      url: resource.url.trim(),
      alt: typeof resource.alt === 'string' ? resource.alt : '',
      isVideo: dpiPairingIsVideo(resource.url.trim())
    }));
}

let dpiPairingAlbum = null;

function dpiEnsurePairingAlbum() {
  if (dpiPairingAlbum) return dpiPairingAlbum;

  const dialog = document.createElement('dialog');
  dialog.className = 'dpi-pairing-album';
  dialog.setAttribute('aria-label', 'Popular Pairings gallery');

  dialog.innerHTML = `
    <div class="dpi-pairing-album__panel">
      <button type="button" class="dpi-pairing-album__close"
        aria-label="Close gallery">×</button>
      <div class="dpi-pairing-album__stage"></div>
      <button type="button"
        class="dpi-pairing-album__arrow dpi-pairing-album__prev"
        aria-label="Previous media"><span>‹</span></button>
      <button type="button"
        class="dpi-pairing-album__arrow dpi-pairing-album__next"
        aria-label="Next media"><span>›</span></button>
      <div class="dpi-pairing-album__caption" aria-live="polite"></div>
      <div class="dpi-pairing-album__thumbs"
        aria-label="Gallery previews"></div>
    </div>
  `;

  section.appendChild(dialog);

  const stage = dialog.querySelector('.dpi-pairing-album__stage');
  const caption = dialog.querySelector('.dpi-pairing-album__caption');
  const thumbs = dialog.querySelector('.dpi-pairing-album__thumbs');
  const previous = dialog.querySelector('.dpi-pairing-album__prev');
  const next = dialog.querySelector('.dpi-pairing-album__next');

  let resources = [];
  let activeIndex = 0;
  let returnFocus = null;
  let previousOverflow = '';

  function clearStage() {
    stage.querySelectorAll('video').forEach(video => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    stage.replaceChildren();
  }

  function show(index) {
    if (!resources.length) return;

    activeIndex = (index + resources.length) % resources.length;
    const resource = resources[activeIndex];

    clearStage();

    const element = document.createElement(
      resource.isVideo ? 'video' : 'img'
    );

    if (resource.isVideo) {
      element.controls = true;
      element.playsInline = true;
      element.preload = 'metadata';
      element.setAttribute(
        'aria-label',
        resource.alt || `Video ${activeIndex + 1}`
      );
    } else {
      element.alt = resource.alt || `Pairing ${activeIndex + 1}`;
    }

    element.src = resource.url;
    stage.appendChild(element);

    caption.textContent =
      `${activeIndex + 1} / ${resources.length}` +
      (resource.alt ? ` · ${resource.alt}` : '');

    Array.from(thumbs.children).forEach((button, index) => {
      const active = index === activeIndex;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    thumbs.children[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }

  function open(items, index, trigger) {
    resources = items;
    if (!resources.length) return;

    returnFocus = trigger || document.activeElement;
    thumbs.replaceChildren();

    resources.forEach((resource, resourceIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dpi-pairing-album__thumb';
      button.setAttribute(
        'aria-label',
        `Show ${resource.isVideo ? 'video' : 'image'} ${resourceIndex + 1}`
      );

      const preview = document.createElement(
        resource.isVideo ? 'video' : 'img'
      );

      if (resource.isVideo) {
        preview.muted = true;
        preview.playsInline = true;
        preview.preload = 'metadata';
        preview.setAttribute('aria-hidden', 'true');
      } else {
        preview.alt = '';
        preview.loading = 'lazy';
      }

      preview.src = resource.url;
      button.appendChild(preview);

      if (resource.isVideo) {
        const badge = document.createElement('span');
        badge.className = 'dpi-pairing-album__video-badge';
        badge.textContent = '▶';
        button.appendChild(badge);
      }

      button.addEventListener('click', () => show(resourceIndex));
      thumbs.appendChild(button);
    });

    previous.hidden = resources.length < 2;
    next.hidden = resources.length < 2;

    if (!dialog.open) {
      previousOverflow = document.documentElement.style.overflow;
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    }

    show(index);
  }

  dialog.querySelector('.dpi-pairing-album__close')
    .addEventListener('click', () => dialog.close());

  // 点击面板外的空白区域关闭。
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  previous.addEventListener('click', () => show(activeIndex - 1));
  next.addEventListener('click', () => show(activeIndex + 1));

  dialog.addEventListener('keydown', event => {
    // 不抢占视频控件的方向键。
    if (event.target.closest('video')) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(activeIndex + 1);
    }
  });

  // Escape 由原生 dialog 处理；关闭时清理视频并恢复焦点。
  dialog.addEventListener('close', () => {
    clearStage();

    thumbs.querySelectorAll('video').forEach(video => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });

    thumbs.replaceChildren();
    resources = [];
    document.documentElement.style.overflow = previousOverflow;

    if (returnFocus?.isConnected) returnFocus.focus();
  });

  dpiPairingAlbum = { open };
  return dpiPairingAlbum;
}

function dpiBuildPairings(media) {
  const resources = dpiPairingResources(media);

  // 保留原数组索引：点击图片时定位到图册中的正确位置。
  const pictures = resources
    .map((resource, index) => ({ resource, index }))
    // .filter(entry => !entry.resource.isVideo)
    .slice(0, 4);

  if (!pictures.length) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'dpi-pairings';

  const title = document.createElement('div');
  title.className = 'dpi-pairings__title';
  title.textContent = 'Popular Pairings';

  const grid = document.createElement('div');
  grid.className = 'dpi-pairings__grid';

  pictures.forEach(({ resource, index }, pictureIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dpi-pairings__card';
    button.setAttribute(
      'aria-label',
      resource.alt || `Open pairing ${pictureIndex + 1}`
    );
    button.setAttribute('aria-haspopup', 'dialog');

    const preview = document.createElement(
      resource.isVideo ? 'video' : 'img'
    );

    if (resource.isVideo) {
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = 'metadata';
      preview.setAttribute('aria-hidden', 'true');
    } else {
      preview.alt = resource.alt || '';
      preview.loading = 'lazy';
    }

    preview.src = resource.url;
    preview.style.cssText =
      'display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;';
    button.appendChild(preview);

    if (resource.isVideo) {
      const badge = document.createElement('span');
      badge.textContent = '▶';
      badge.setAttribute('aria-hidden', 'true');
      badge.style.cssText =
        'position:absolute;right:8px;bottom:8px;z-index:1;' +
        'display:grid;place-items:center;width:28px;height:28px;line-height:28px;' +
        'border-radius:50%;background:rgba(0,0,0,.55);color:#fff;' +
        'font-size:13px;pointer-events:none;';
      button.appendChild(badge);
    }


    if (pictureIndex === 3) {
      const more = document.createElement('span');
      more.className = 'dpi-pairings__more';
      more.textContent = 'View More';
      button.appendChild(more);
    }

    button.addEventListener('click', () => {
      dpiEnsurePairingAlbum().open(resources, index, button);
    });

    grid.appendChild(button);
  });

  wrapper.append(title, grid);
  return wrapper;
}

function renderPairings(media, index) {
  const content = dpiBuildPairings(media);
  if (!content) return;

  const item = createMediaItem(index, 'dpi-media-item--pairings');
  item.appendChild(content);
  mediaGridEl.appendChild(item);
}

//end 画廊

// ── mediaType 1 — Image ───────────────────────────────────────────────────
function renderImage(media, index) {
  const item = createMediaItem(index, 'dpi-media-item--product');
  const img = document.createElement('img');
  img.src = media.url;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(media.url));
  img.style.cursor = 'zoom-in';

  item.appendChild(img);

  if (media.extraInfo) {
    const label = document.createElement('div');
    label.className = 'dpi-media-label';
    label.textContent = media.extraInfo;
    item.appendChild(label);
  }

  mediaGridEl.appendChild(item);
}

// ── mediaType 2 — Video ───────────────────────────────────────────────────
function renderVideo(media, index) {
  const item = createMediaItem(index);
  const video = document.createElement('video');
  video.src = media.url;
  video.poster = media.previewImage || '';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;

  video.addEventListener('mouseenter', () => video.play());
  video.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });

  item.appendChild(video);
  mediaGridEl.appendChild(item);
}

// ── mediaType 3 — 3D Model ────────────────────────────────────────────────
function renderModel(media, index) {
  const item = createMediaItem(index, 'dpi-media-item--product');

  const preview = document.createElement('img');
  preview.src = media.previewImage || '';
  preview.alt = '3D Model';
  preview.style.cursor = 'pointer';
  preview.loading = 'lazy';
  preview.addEventListener('click', () => openModelModal(media.url));

  const badge = document.createElement('div');
  badge.className = 'dpi-thumb__badge';
  badge.textContent = '3D';

  item.appendChild(preview);
  item.appendChild(badge);
  mediaGridEl.appendChild(item);
}

// ── mediaType 4 — 3D Spin ─────────────────────────────────────────────────
function renderSpin(media, index) {
  const item = createMediaItem(index, 'dpi-media-item--product');

  const { url, imageName, imageSuffix, imageNumber } = media;

  const TOTAL_FRAMES = imageNumber || 1;

  // 鼠标拖动灵敏度
  // 数值越小，鼠标移动相同距离时旋转越快
  const SENSITIVITY = 1.0;

  // 自动旋转速度
  const AUTO_PLAY_SPEED = 0.5;

  // 惯性衰减速度
  // 数值越小，松手后停止越快
  const FRICTION = 0.90;

  // 松手时的速度放大倍数
  const SPEED_BOOST = 2.5;

  // 松手后的最大惯性速度
  const MAX_INERTIA = 0.8;

  const frameUrls = [];

  for (let i = 1; i <= TOTAL_FRAMES; i++) {
    frameUrls.push(
      url + imageName + i + '.' + imageSuffix
    );
  }

  const canvas = document.createElement('canvas');

  canvas.width = 800;
  canvas.height = 800;

  canvas.style.cssText = `
    width: 100%;
    height: 100%;
    object-fit: contain;
    cursor: grab;
    display: block;
    transform: translateZ(0);
    touch-action: none;
  `;

  const loader = document.createElement('div');

  loader.className = 'dpi-spin-loader';

  loader.innerHTML = `
    <div style="text-align: center;">
      <span id="dpi-spin-text-${index}">Loading…</span>

      <div
        style="
          width: 160px;
          height: 5px;
          background: #e0e0e0;
          border-radius: 3px;
          margin-top: 10px;
          overflow: hidden;
        "
      >
        <div
          id="dpi-spin-bar-${index}"
          style="
            width: 0%;
            height: 100%;
            background: #1a3a4a;
            transition: width 0.1s;
          "
        ></div>
      </div>
    </div>
  `;

  const dragLabel = document.createElement('div');

  dragLabel.className = 'dpi-drag-label';
  dragLabel.textContent = 'Drag to Spin';
  dragLabel.style.opacity = '1';

  item.appendChild(canvas);
  item.appendChild(loader);
  item.appendChild(dragLabel);

  mediaGridEl.appendChild(item);

  const ctx = canvas.getContext('2d');
  const spinLifecycle = dpiCreateSpinLifecycle(canvas);


  const imgs = new Array(TOTAL_FRAMES);

  let loadedCount = 0;
  let isReady = false;

  let currentFrameFloat = 0.0;
  let lastRenderedFrame = -1;

  let isDragging = false;
  let isMouseOver = false;

  let startX = 0;
  let startFrameFloat = 0.0;

  let trackX = 0;
  let trackTime = 0;

  let finalVelocity = 0;
  let inertiaSpeed = 0;

  

  // 用于根据真实帧间隔计算速度
  let lastAnimationTime = 0;

  const spinTextEl = document.getElementById(
    `dpi-spin-text-${index}`
  );

  const spinBarEl = document.getElementById(
    `dpi-spin-bar-${index}`
  );

  function clampFrame(frame) {
    return (
      (frame % TOTAL_FRAMES + TOTAL_FRAMES) %
      TOTAL_FRAMES
    );
  }

  function renderFrame(frameFloat) {
    const frame = Math.round(
      clampFrame(frameFloat)
    );

    if (frame === lastRenderedFrame) {
      return;
    }

    const img = imgs[frame];

    if (
      img &&
      img.complete &&
      img.naturalWidth > 0
    ) {
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      ctx.drawImage(
        img,
        0,
        0,
        canvas.width,
        canvas.height
      );

      lastRenderedFrame = frame;
    }
  }

  function animate(now = performance.now()) {
    if (spinLifecycle.disposed) return;

    if (!lastAnimationTime) {
      lastAnimationTime = now;
    }

    // 以 60fps 为基准计算时间差，
    // 防止高刷新率屏幕旋转速度过快
    const deltaTime = Math.min(
      (now - lastAnimationTime) / 16.667,
      2
    );

    lastAnimationTime = now;

    if (!isDragging && isReady) {
      if (Math.abs(inertiaSpeed) > 0) {
        currentFrameFloat -=
          inertiaSpeed * deltaTime;

        // 根据实际时间逐渐降低惯性
        inertiaSpeed *= Math.pow(
          FRICTION,
          deltaTime
        );

        // 速度足够小时直接停止
        if (Math.abs(inertiaSpeed) < 0.02) {
          inertiaSpeed = 0;
        }
      }

      // 没有惯性并且鼠标不在图片上时，缓慢自动旋转
      if (
        inertiaSpeed === 0 &&
        !isMouseOver
      ) {
        currentFrameFloat +=
          AUTO_PLAY_SPEED * deltaTime;
      }

      renderFrame(currentFrameFloat);
    }

    spinLifecycle.requestFrame(animate);

  }

  // 先加载第 1 帧并立即显示
  const firstImg = spinLifecycle.trackImage(new Image());

  firstImg.onload = () => {
    if (firstImg.naturalWidth > 0) {
      canvas.width = firstImg.naturalWidth;
      canvas.height = firstImg.naturalHeight;
    }

    imgs[0] = firstImg;

    // 先显示第 1 帧
    renderFrame(0);

    // 然后加载剩余所有帧
    preloadAllFrames();
  };

  firstImg.onerror = () => {
    // 第 1 帧失败时，也继续尝试加载其他帧
    preloadAllFrames();
  };

  firstImg.src = frameUrls[0];

  function preloadAllFrames() {
    if (spinLifecycle.disposed) return;
    loadedCount = 0;

    frameUrls.forEach((src, idx) => {
      // 第 1 帧已经加载过，直接计数
      if (idx === 0 && imgs[0]) {
        loadedCount++;

        updateLoader();

        if (loadedCount === TOTAL_FRAMES) {
          finishLoading();
        }

        return;
      }

      const img = spinLifecycle.trackImage(new Image());


      img.onload = () => {
        loadedCount++;

        updateLoader();

        if (loadedCount === TOTAL_FRAMES) {
          finishLoading();
        }
      };

      img.onerror = () => {
        loadedCount++;

        updateLoader();

        if (loadedCount === TOTAL_FRAMES) {
          finishLoading();
        }
      };

      img.src = src;
      imgs[idx] = img;
    });
  }

  function updateLoader() {
    const percentage = Math.floor(
      (loadedCount / TOTAL_FRAMES) * 100
    );

    if (spinBarEl) {
      spinBarEl.style.width =
        percentage + '%';
    }

    if (spinTextEl) {
      spinTextEl.textContent =
        percentage + '%';
    }
  }

  function finishLoading() {
    if (spinLifecycle.disposed) return;
    isReady = true;

    loader.style.opacity = '0';

    spinLifecycle.delay(() => {
      loader.style.display = 'none';
    }, 300);

    // 所有图片加载完成后开始动画
    animate();
  }

  item.addEventListener('mouseenter', () => {
    isMouseOver = true;
  });

  item.addEventListener('mouseleave', () => {
    isMouseOver = false;

    dragLabel.style.opacity = '1';

    if (isDragging) {
      handleEnd();
    }
  });

  function handleStart(event) {
    if (!isReady) {
      return;
    }

    isDragging = true;
    inertiaSpeed = 0;
    finalVelocity = 0;

    dragLabel.style.opacity = '0';
    canvas.style.cursor = 'grabbing';

    const clientX =
      event.clientX ??
      event.touches?.[0]?.clientX ??
      0;

    startX = clientX;
    startFrameFloat = currentFrameFloat;

    trackX = clientX;
    trackTime = performance.now();
  }

  function handleMove(event) {
    if (!isDragging) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    const clientX =
      event.clientX ??
      event.touches?.[0]?.clientX ??
      0;

    const now = performance.now();

    const deltaX = clientX - startX;

    // 鼠标拖动时实时旋转
    currentFrameFloat =
      startFrameFloat -
      deltaX / SENSITIVITY;

    renderFrame(currentFrameFloat);

    const dt = now - trackTime;

    if (dt > 0) {
      const instantVelocity =
        (clientX - trackX) / dt;

      // 平滑计算速度，防止松手瞬间加速
      finalVelocity =
        finalVelocity * 0.75 +
        instantVelocity * 0.25;

      trackX = clientX;
      trackTime = now;
    }
  }

  function handleEnd() {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    canvas.style.cursor = 'grab';

    // 限制松手后的惯性速度
    inertiaSpeed = Math.max(
      -MAX_INERTIA,
      Math.min(
        MAX_INERTIA,
        finalVelocity * SPEED_BOOST
      )
    );

    finalVelocity = 0;
  }

  // 鼠标事件
  // 全局事件由当前实例管理，销毁时统一解绑
  spinLifecycle.listen(canvas, 'mousedown', handleStart);
  spinLifecycle.listen(window, 'mousemove', handleMove);
  spinLifecycle.listen(window, 'mouseup', handleEnd);

  spinLifecycle.listen(canvas, 'touchstart', event => {
    isMouseOver = true;
    handleStart(event);
  }, { passive: false });

  spinLifecycle.listen(canvas, 'touchmove', handleMove, {
    passive: false
  });

  function handleTouchEnd() {
    isMouseOver = false;
    handleEnd();
  }

  spinLifecycle.listen(window, 'touchend', handleTouchEnd);
  spinLifecycle.listen(window, 'touchcancel', handleTouchEnd);

}

// ── mediaType 5 — Skin Tone Slider ──────────────────────────────────────────
function renderSkinTone(media, index) {
  const item = createMediaItem(index, 'dpi-media-item--skin-tone');

  // ── 从 section block 读取3张皮肤图配置 ──
  // 通过 data-* 属性从 Liquid 传入（见下方 Liquid 改动）
  const skinToneEl = document.getElementById('dpi-skin-tone-data');
  const imgDarkSrc   = skinToneEl?.dataset.imgDark   || '';
  const imgMediumSrc = skinToneEl?.dataset.imgMedium || '';
  const imgLightSrc  = skinToneEl?.dataset.imgLight  || '';

  item.innerHTML = `
    <div class="dpi-skin-tone__images">
      <img class="dpi-skin-tone__img dpi-skin-tone__img--dark"
           src="${imgDarkSrc}" alt="Dark skin tone" loading="lazy"
           style="opacity:0;">
      <img class="dpi-skin-tone__img dpi-skin-tone__img--medium"
           src="${imgMediumSrc}" alt="Medium skin tone" loading="lazy"
           style="opacity:1;">
      <img class="dpi-skin-tone__img dpi-skin-tone__img--light"
           src="${imgLightSrc}" alt="Light skin tone" loading="lazy"
           style="opacity:0;">
      <!-- 钻石叠加层：透明底PNG，由API数据注入 -->
      <img class="dpi-skin-tone__img dpi-skin-tone__img--diamond"
           id="dpi-skin-diamond" src="" alt="Diamond"
           style="opacity:0;z-index:1;pointer-events:none;object-fit:contain;">
    </div>
    <div class="dpi-skin-tone__slider-wrap">
      <span class="dpi-skin-tone__label dpi-skin-tone__label--top">Lighter</span>
      <div class="dpi-skin-tone__track">
        <input class="dpi-skin-tone__range" id="dpi-skin-range"
               type="range" min="0" max="100" value="50" step="1"
               orient="vertical">
      </div>
      <span class="dpi-skin-tone__label dpi-skin-tone__label--bottom">Darker</span>
    </div>
  `;

  mediaGridEl.appendChild(item);

  // ── 绑定滑块交互 ──
  const range     = item.querySelector('#dpi-skin-range');
  const imgDark   = item.querySelector('.dpi-skin-tone__img--dark');
  const imgMedium = item.querySelector('.dpi-skin-tone__img--medium');
  const imgLight  = item.querySelector('.dpi-skin-tone__img--light');

  function updateOpacity(val) {
    const v = Number(val);
    let oDark, oMedium, oLight;
    if (v <= 50) {
      const t = v / 50;
      oDark = 1 - t; oMedium = t; oLight = 0;
    } else {
      const t = (v - 50) / 50;
      oDark = 0; oMedium = 1 - t; oLight = t;
    }
    if (imgDark)   imgDark.style.opacity   = oDark;
    if (imgMedium) imgMedium.style.opacity = oMedium;
    if (imgLight)  imgLight.style.opacity  = oLight;
  }

  updateOpacity(range.value);
  range.addEventListener('input', (e) => updateOpacity(e.target.value));
}

// ── 钻石图注入（透明底PNG叠加在皮肤图之上）────────────────────────────────
function injectDiamondImage(url) {
  const diamondImg = document.getElementById('dpi-skin-diamond');
  if (!diamondImg || !url) return;
  diamondImg.src = url;
  diamondImg.style.opacity = '1';
}



// ── 主入口：渲染所有媒体 ──────────────────────────────────────────────────
function populateMedia(medias) {
  currentSortedMedias = (Array.isArray(medias) ? [...medias] : [])
    .filter(media =>
      media.mediaType !== 6 ||
      dpiPairingResources(media).length > 0
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  applyResponsiveMedia(currentSortedMedias);
}

function applyResponsiveMedia(mediasToRender) {
  // 必须先销毁动画和全局监听，再移除节点
  dpiDestroySpins();

  section.querySelectorAll(
    '.dpi-media-grid video, .dpi-carousel-main video'
  ).forEach(video => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });

  dpiRemoveMobileCarousel();
  mediaGridEl.innerHTML = '';

  dpiMediaMode = window.innerWidth <= 900 ? 'mobile' : 'desktop';

  if (!mediasToRender.length) {
    mediaGridEl.style.display = '';
    mediaGridEl.innerHTML =
      '<div style="padding:40px;color:#aaa;text-align:center;grid-column:1/-1;">No media available</div>';
    return;
  }

  if (dpiMediaMode === 'mobile') {
    // 手机只创建轮播，不再创建隐藏的桌面旋转
    mediaGridEl.style.display = 'none';
    initMobileCarousel(mediasToRender);
  } else {
    mediaGridEl.style.display = '';

    mediasToRender.forEach((media, index) => {
      switch (media.mediaType) {
        case 1: renderImage(media, index);    break;
        case 2: renderVideo(media, index);    break;
        case 3: renderModel(media, index);    break;
        case 4: renderSpin(media, index);     break;
        case 5: renderSkinTone(media, index); break;
        case 6: renderPairings(media, index); break;
        default: renderImage(media, index);
      }
    });

    const diamondMedia = mediasToRender.find(
      media => media.mediaType === 5
    );
    if (diamondMedia) injectDiamondImage(diamondMedia.url);
  }
}

let dpiResizeTimer = null;

function dpiHandleMediaResize() {
  clearTimeout(dpiResizeTimer);

  dpiResizeTimer = setTimeout(() => {
    if (!section.isConnected) {
      dpiDisposeMedia();
      return;
    }

    const nextMode = window.innerWidth <= 900
      ? 'mobile'
      : 'desktop';

    // 只有跨越断点才重建，不随每一次 resize 重建
    if (dpiMediaMode !== null && nextMode !== dpiMediaMode) {
      applyResponsiveMedia(currentSortedMedias);
    }
  }, 200);
}

function dpiDisposeMedia() {
  clearTimeout(dpiResizeTimer);
  dpiDestroySpins();
  window.removeEventListener('resize', dpiHandleMediaResize);
  document.removeEventListener(
    'shopify:section:unload',
    dpiHandleSectionUnload
  );
}

function dpiHandleSectionUnload(event) {
  if (
    event.target === section ||
    event.target?.contains(section)
  ) {
    dpiDisposeMedia();
  }
}

window.addEventListener('resize', dpiHandleMediaResize);
document.addEventListener(
  'shopify:section:unload',
  dpiHandleSectionUnload
);

 
// ── 移动端轮播 ────────────────────────────────────────────────────────────
function initMobileCarousel(medias) {
  // 清理旧节点，避免重复渲染
  const oldMain   = section.querySelector('.dpi-carousel-main');
  const oldThumbs = section.querySelector('.dpi-carousel-thumbs');
  if (oldMain)   oldMain.remove();
  if (oldThumbs) oldThumbs.remove();
 
  const mediaEl = section.querySelector('.dpi-gallery');
  const grid    = section.querySelector('.dpi-media-grid');
  if (!mediaEl || !grid) return;
 
  const main  = document.createElement('div');
  main.className = 'dpi-carousel-main';
  const track = document.createElement('div');
  track.className = 'dpi-carousel-track';
  main.appendChild(track);
 
  const thumbsBar = document.createElement('div');
  thumbsBar.className = 'dpi-carousel-thumbs';
 
  let currentIndex = 0;
 
  medias.forEach((media, i) => {
    const slide = document.createElement('div');
    slide.className = 'dpi-carousel-slide';
 
    // ── 主图 slide 按 mediaType 处理 ──
    switch (media.mediaType) {
      case 2: { // 视频
        const video = document.createElement('video');
        video.src = media.url;
        video.poster = media.previewImage || '';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        slide.appendChild(video);
        break;
      }
 
      case 3: { // 3D 模型
        const img = document.createElement('img');
        img.src = media.previewImage || '';
        img.alt = '3D Model';
        img.loading = 'lazy';
        const badge = document.createElement('div');
        badge.className = 'dpi-thumb__badge';
        badge.textContent = '3D';
        slide.style.position = 'relative';
        slide.appendChild(img);
        slide.appendChild(badge);
        slide.addEventListener('click', () => openModelModal(media.url));
        break;
      }
 
      case 4: { // 360° Spin —— 复用完整 canvas 动画
        const { url, imageName, imageSuffix, imageNumber } = media;
        const TOTAL_FRAMES    = imageNumber || 1;
        const SENSITIVITY     = 8.0;
        const AUTO_PLAY_SPEED = 0.3;
        const FRICTION        = 0.985;
        const SPEED_BOOST     = 15.0;
        const MAX_INERTIA     = 5.0;
 
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 800;
        canvas.style.cssText = 'width:100%;height:auto;object-fit:contain;cursor:grab;display:block;transform:translateZ(0);';
 
        const spinUid = 'mobile_' + i;
        const loader = document.createElement('div');
        loader.className = 'dpi-spin-loader';
        loader.innerHTML = `<span id="dpi-spin-text-${spinUid}">Loading…</span><div style="width:160px;height:5px;background:#e0e0e0;border-radius:3px;margin-top:10px;overflow:hidden;"><div id="dpi-spin-bar-${spinUid}" style="width:0%;height:100%;background:#1a3a4a;transition:width 0.1s;"></div></div>`;
 
        const dragLabel = document.createElement('div');
        dragLabel.className = 'dpi-drag-label';
        dragLabel.textContent = 'Drag to Spin';
 
        slide.style.position = 'relative';
        slide.appendChild(canvas);
        slide.appendChild(loader);
        slide.appendChild(dragLabel);
 
        const ctx = canvas.getContext('2d');
        const spinLifecycle = dpiCreateSpinLifecycle(canvas);
        const frameUrls = [];
        for (let f = 1; f <= TOTAL_FRAMES; f++) {
          frameUrls.push(url + imageName + f + '.' + imageSuffix);
        }
 
        const imgs = new Array(TOTAL_FRAMES);
        let loadedCount = 0, isReady = false, firstFrameShown = false;
        let currentFrameFloat = 0.0, lastRenderedFrame = -1;
        let isDragging = false, isMouseOver = false;
        let startX = 0, startFrameFloat = 0.0;
        let trackX = 0, trackTime = 0, finalVelocity = 0, inertiaSpeed = 0;
 
        const spinTextEl = loader.querySelector(`[id="dpi-spin-text-${spinUid}"]`);
        const spinBarEl = loader.querySelector(`[id="dpi-spin-bar-${spinUid}"]`);
        
        function clampFrame(f) { return (f % TOTAL_FRAMES + TOTAL_FRAMES) % TOTAL_FRAMES; }
        function renderFrame(ff) {
          const f = Math.round(clampFrame(ff));
          if (f === lastRenderedFrame) return;
          const img = imgs[f];
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            lastRenderedFrame = f;
          }
        }
        function animate() {
          if (spinLifecycle.disposed) return;
          if (!isDragging && isReady) {
            if (inertiaSpeed !== 0) {
              currentFrameFloat -= inertiaSpeed;
              inertiaSpeed *= FRICTION;
              if (inertiaSpeed < 0) { if (-inertiaSpeed <= AUTO_PLAY_SPEED) inertiaSpeed = 0; }
              else { if (inertiaSpeed <= 0.15) inertiaSpeed = 0; }
            }
            if (inertiaSpeed === 0 && !isMouseOver) currentFrameFloat += AUTO_PLAY_SPEED;
            renderFrame(currentFrameFloat);
          }
          spinLifecycle.requestFrame(animate);
        }
 
        frameUrls.forEach((src, idx) => {
          const img = spinLifecycle.trackImage(new Image());
          img.onload = () => {
            loadedCount++;
            const pct = Math.floor((loadedCount / TOTAL_FRAMES) * 100);
            if (spinBarEl)  spinBarEl.style.width = pct + '%';
            if (spinTextEl) spinTextEl.textContent = pct + '%';
            if (idx === 0 && !firstFrameShown) {
              firstFrameShown = true;
              if (img.naturalWidth > 0) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
              renderFrame(0);
            }
            if (loadedCount === TOTAL_FRAMES) {
              isReady = true;
              loader.style.opacity = '0';
              spinLifecycle.delay(() => {
                loader.style.display = 'none';
              }, 300);

            }
          };
          img.onerror = () => { loadedCount++; };
          img.src = src;
          imgs[idx] = img;
        });
        animate();
 
        // 触摸拖拽旋转（stopPropagation 避免触发轮播滑动）
        function handleSpinStart(e) {
          if (!isReady) return;
          isDragging = true; inertiaSpeed = 0; finalVelocity = 0;
          dragLabel.style.opacity = '0';
          canvas.style.cursor = 'grabbing';
          const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
          startX = clientX; startFrameFloat = currentFrameFloat;
          trackX = clientX; trackTime = performance.now();
        }
        function handleSpinMove(e) {
          if (!isDragging) return;
          if (e.cancelable) e.preventDefault();
          const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
          const now = performance.now();
          currentFrameFloat = clampFrame(startFrameFloat - (clientX - startX) / SENSITIVITY);
          renderFrame(currentFrameFloat);
          const dt = now - trackTime;
          if (dt > 0) { finalVelocity = (clientX - trackX) / dt; trackX = clientX; trackTime = now; }
        }
        function handleSpinEnd() {
          if (!isDragging) return;
          isDragging = false;
          canvas.style.cursor = 'grab';
          inertiaSpeed = Math.max(-MAX_INERTIA, Math.min(MAX_INERTIA, finalVelocity * SPEED_BOOST));
          finalVelocity = 0;
        }
 
        spinLifecycle.listen(canvas, 'mousedown', handleSpinStart);
        spinLifecycle.listen(window, 'mousemove', handleSpinMove);
        spinLifecycle.listen(window, 'mouseup', handleSpinEnd);

        spinLifecycle.listen(canvas, 'touchstart', event => {
          isMouseOver = true;
          handleSpinStart(event);
          event.stopPropagation();
        }, { passive: false });

        spinLifecycle.listen(canvas, 'touchmove', event => {
          handleSpinMove(event);
          event.stopPropagation();
        }, { passive: false });

        function finishSpinTouch(event) {
          isMouseOver = false;
          handleSpinEnd();
          event.stopPropagation();
        }

        spinLifecycle.listen(canvas, 'touchend', finishSpinTouch, {
          passive: false
        });
        spinLifecycle.listen(canvas, 'touchcancel', finishSpinTouch, {
          passive: false
        });

        spinLifecycle.listen(window, 'touchend', () => {
          isMouseOver = false;
          handleSpinEnd();
        });
        spinLifecycle.listen(window, 'touchcancel', () => {
          isMouseOver = false;
          handleSpinEnd();
        });

        spinLifecycle.listen(canvas, 'mouseenter', () => {
          isMouseOver = true;
        });
        spinLifecycle.listen(canvas, 'mouseleave', () => {
          isMouseOver = false;
          if (isDragging) handleSpinEnd();
        });

        break;
      }
 
      case 5: { // Skin Tone：移动端主图取 medium 图
        const dataEl = document.getElementById('dpi-skin-tone-data');
        const img = document.createElement('img');
        img.src = dataEl?.dataset.imgMedium || '';
        img.alt = 'Skin tone';
        img.loading = 'lazy';
        slide.appendChild(img);
        break;
      }
      case 6: {
        const content = dpiBuildPairings(media);
        if (content) slide.appendChild(content);
        break;
      }

 
      default: { // 普通图片
        const img = document.createElement('img');
        img.src = media.url;
        img.alt = '';
        img.loading = i === 0 ? 'eager' : 'lazy';
        slide.addEventListener('click', () => openLightbox(media.url));
        slide.appendChild(img);
      }
    }
 
    track.appendChild(slide);
 
    // ── 缩略图：按 mediaType 取预览图 ──
    const thumb = document.createElement('div');
    thumb.className = 'dpi-carousel-thumb' + (i === 0 ? ' active' : '');
 
    const tImg = document.createElement('img');
    tImg.alt = '';
    tImg.loading = 'lazy';
 
    switch (media.mediaType) {
      case 2: // 视频：用 poster
        tImg.src = media.previewImage || '';
        break;
      case 3: // 3D 模型：用 previewImage
        tImg.src = media.previewImage || '';
        break;
      case 4: // Spin：用第一帧
        tImg.src = (media.url || '') + (media.imageName || '') + '1.' + (media.imageSuffix || 'jpg');
        break;
      case 5: { // Skin tone：用 medium 图
        const dataEl = document.getElementById('dpi-skin-tone-data');
        tImg.src = dataEl?.dataset.imgMedium || '';
        break;
      }
      case 6: {
        const firstImage = dpiPairingResources(media)
          .find(resource => !resource.isVideo);

        tImg.src = firstImage?.url || '';
        tImg.alt = 'Popular Pairings';
        break;
      }

      default: // 图片
        tImg.src = media.url || '';
    }
 
    thumb.appendChild(tImg);
    thumb.addEventListener('click', () => goTo(i));
    thumbsBar.appendChild(thumb);
  });
 
  function goTo(idx) {
    currentIndex = idx;
    track.style.transform = `translateX(-${idx * 100}%)`;
    thumbsBar.querySelectorAll('.dpi-carousel-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === idx);
    });
    const activeThumb = thumbsBar.children[idx];
    if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
 
  // 主图触摸滑动
  let touchStartX = 0, touchDeltaX = 0;
  main.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchDeltaX = 0; }, { passive: true });
  main.addEventListener('touchmove',  e => { touchDeltaX = e.touches[0].clientX - touchStartX; }, { passive: true });
  main.addEventListener('touchend', () => {
    if (Math.abs(touchDeltaX) > 40) {
      const dir = touchDeltaX < 0 ? 1 : -1;
      const next = Math.max(0, Math.min(medias.length - 1, currentIndex + dir));
      goTo(next);
    }
  });
 
  // 缩略图横向触摸拖动
  let thumbTouchStartX = 0, thumbScrollStart = 0, thumbIsDragging = false;
  thumbsBar.addEventListener('touchstart', e => {
    thumbTouchStartX = e.touches[0].clientX;
    thumbScrollStart = thumbsBar.scrollLeft;
    thumbIsDragging = true;
  }, { passive: true });
  thumbsBar.addEventListener('touchmove', e => {
    if (!thumbIsDragging) return;
    thumbsBar.scrollLeft = thumbScrollStart + (thumbTouchStartX - e.touches[0].clientX);
  }, { passive: true });
  thumbsBar.addEventListener('touchend', () => { thumbIsDragging = false; }, { passive: true });
 
  // 缩略图鼠标拖动（桌面调试用）
  let mouseDown = false, mouseStartX = 0, mouseScrollStart = 0;
  thumbsBar.addEventListener('mousedown', e => {
    mouseDown = true; mouseStartX = e.clientX; mouseScrollStart = thumbsBar.scrollLeft;
    thumbsBar.style.cursor = 'grabbing'; e.preventDefault();
  });
  thumbsBar.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    thumbsBar.scrollLeft = mouseScrollStart + (mouseStartX - e.clientX);
  });
  thumbsBar.addEventListener('mouseup',    () => { mouseDown = false; thumbsBar.style.cursor = ''; });
  thumbsBar.addEventListener('mouseleave', () => { mouseDown = false; thumbsBar.style.cursor = ''; });
 
  // 插入到网格之前
  mediaEl.insertBefore(main, grid);
  mediaEl.insertBefore(thumbsBar, grid);
}
//end主图移动端新增

// ── Fallback ──────────────────────────────────────────────────────────────
function populateMediaFallback() {
  const images = window.__dpi_images || [];
  const medias = images.map((src, i) => ({
    mediaType: 1,
    url: src,
    sortOrder: i + 1,
  }));
  populateMedia(medias);
}



  

  // 将 API 钻石属性填入参数卡片。
  // 使用 document 查找，兼容卡片位于其他 section 的情况。
  function populateDiamondParamItems(product, root = document) {
    const attribute = product?.attribute || {};
    const allowedKeys = ['carat', 'color', 'cut', 'clarity'];

    // 与 populateInfo() 的 symmetry 回退转换保持一致。
    function getSymmetryCut(symm) {
      return symm === 'EX' ? 'EX'
        : symm === 'VG' ? 'Very Good'
        : symm === 'GD' ? 'Good'
        : symm === 'ID' ? 'Ideal'
        : symm === 'VERYGOOD' ? 'Very Good'
        : '';
    }

    function getCutValue(attr) {
      if (attr.cut) {
        if (attr.cut === 'Id') {
          return 'Ideal';
        }

        if (attr.cut === '-') {
          return getSymmetryCut(attr.symm);
        }

        return attr.cut;
      }

      return getSymmetryCut(attr.symm);
    }

    root.querySelectorAll('[data-hsd-diamond-param]').forEach(element => {
      const key = element.dataset.hsdDiamondParam;

      if (!allowedKeys.includes(key)) return;

      const value = key === 'cut'
        ? getCutValue(attribute)
        : attribute[key];

      element.textContent =
        value === undefined || value === null || value === ''
          ? '—'
          : String(value);
    });
  }



  // ── Populate info panel from API data ────────────────────────────────────
  function populateInfo(data){
    const attr=data.attribute||{};

    const displayValue=(value)=>{
      if(value===undefined||value===null||value===''){
        return '—';
      }

      return String(value);
    };

    if(diamondReportEl&&attr.report){
      const report=String(attr.report)
        .replace('(SH)','')
        .trim();

      diamondReportEl.innerHTML=`
        <span class="dpi-rp__igi-badge">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"/>
          </svg>
          ${report} Certified
        </span>
      `;
    }

    if(diamondCaratEl){
      diamondCaratEl.textContent=displayValue(attr.carat);
    }

    if(diamondColorEl){
      diamondColorEl.textContent=displayValue(
        attr.fancyColor||attr.color
      );
    }

    if(diamondCutEl){
      let cut = '';
      if(attr.cut){
        if(attr.cut=="Id"){
          cut = 'Ideal';
        }else if(attr.cut=='-'){
          if(attr.symm){
            cut = attr.symm=='EX'?attr.symm:
            attr.symm=='VG'?'Very Good':
            attr.symm=='GD'?'Good':
            attr.symm=='ID'?'Ideal':
            attr.symm=='VERYGOOD'?'Very Good':"";
          }
          
        }else{
          cut = attr.cut;
        }
      }else{
          if(attr.symm){
            cut = attr.symm=='EX'?attr.symm:
            attr.symm=='VG'?'Very Good':
            attr.symm=='GD'?'Good':
            attr.symm=='ID'?'Ideal':
            attr.symm=='VERYGOOD'?'Very Good':"";
          }
      }
      diamondCutEl.textContent=displayValue(cut);
    }

    if(diamondClarityEl){
      diamondClarityEl.textContent=displayValue(attr.clarity);
    }

    if(diamondSkuEl){
      let report = null;
      if(attr.thirdApiId){
        report = attr.thirdApiId
      }
      diamondSkuEl.textContent=displayValue(report);
    }

    if(diamondSymmetryEl){
      diamondSymmetryEl.textContent=displayValue(
        attr.symm||attr.symmetry
      );
    }

    if(diamondPolishEl){
      diamondPolishEl.textContent=displayValue(
        attr.pol||attr.polish
      );
    }

    if(diamondMeasurementsEl){
      const measurements=[
        attr.diamondLength,
        attr.diamondWidth,
        attr.diamondHeight
      ].filter((value)=>{
        return value!==undefined&&value!==null&&value!=='';
      });

      diamondMeasurementsEl.textContent=
        measurements.length===3
          ? measurements.join(' × ')
          : '—';
    }
  }



  // ── Fetch from API ────────────────────────────────────────────────────────
  async function fetchProductData() {
   
    if (!API_BASE || !PRODUCT_ID) {
      // Fallback: use Shopify native images
      populateMediaFallback();
      return;
    }

    try {
      const url = `${API_BASE}/store/product/details/${PRODUCT_ID}?shopDomain=${SHOP_DOMAIN}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error('API error ' + res.status);
      const json = await res.json();

      if (json.code === 'ok' && json.data && json.data.product) {
        const product = json.data.product;
        currentProductData = product;
        populateDiamondParamItems(product);
        dpiSyncWishlistBtn(); // 数据就绪后同步按钮状态 
        let medias  = product.attribute?.medias || [];
          // 如果 defaultMedias 为空，用 pictures 字段
          if (medias.length === 0 && product.pictures) {
            medias = product.pictures.split(',').map((url, i) => ({
              mediaType: 1, url: url.trim(), sortOrder: i + 1
            }));
          }
        populateMedia(medias);
        populateInfo(product);
      } else {
        throw new Error('Unexpected response');
      }
    } catch (err) {
      console.warn('[DPI] API fetch failed, using fallback.', err);
      populateMediaFallback();
    }
  }

  function mergePartialAttributes(source, attrKeys) {
    const result = { ...source };
    
    // 遍历指定的 attribute 键名
    attrKeys.forEach(key => {
      // 只有当外层对象中不存在该键时，才从 attribute 中复制
      if (!(key in result) && source.attribute && key in source.attribute) {
        result[key] = source.attribute[key];
      }
    });
    
    // 可选：删除原 attribute 对象
    delete result.attribute;
    
    return result;
  }

  // ── Fallback: use Shopify product images ──────────────────────────────────
  function populateMediaFallback() {
    // Shopify injects window.__dpi_images via Liquid below
    const images = window.__dpi_images || [];
    const medias  = images.map((src, i) => ({
      mediaType: 1,
      url: src,
      sortOrder: i + 1,
    }));
    populateMedia(medias);
  }
  
  // === Choose Diamond Button ===
if (chooseBtnEl && !chooseBtnEl.disabled) {
  chooseBtnEl.addEventListener('click', () => {
    if (!currentProductData) {
      console.warn('[DPI] Diamond data not loaded yet');
      return;
    }
    const keysToCopy = ['shape', 'carat', 'color','fancyColor', 'clarity', 'cut','pol','symm','flo','lab','diamondLength','diamondWidth','diamondHeight','depth','diamondTable','pricePerCarat','pdf','medias'];
    const transformedData = mergePartialAttributes(currentProductData,keysToCopy);

    localStorage.setItem('current_diamond', JSON.stringify(transformedData));

    const ringSetting = localStorage.getItem('current_ringsetting');
    if (ringSetting) {
      window.location.href = '/pages/purchase-review';
    } else {
      localStorage.setItem('select_purchase_number', 'diamond');
      let current_collections_ringsetting = localStorage.getItem('current_collections_ringsetting');
      if(!current_collections_ringsetting){
        current_collections_ringsetting = '/collections/start-with-a-setting';
        localStorage.setItem('current_collections_ringsetting',current_collections_ringsetting);
      }
      window.location.href = current_collections_ringsetting;
    }
  });
}


  // ── Init ──────────────────────────────────────────────────────────────────
  fetchProductData();
  const wishlistBtn = document.querySelector('.dpi-btn--wishlist');
  if (wishlistBtn) {
    wishlistBtn.addEventListener('click', dpiToggleWishlist);
  }

})();
