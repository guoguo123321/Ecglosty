(function () {
  'use strict';
    // 放在 window 上，兼容同一脚本被再次执行
  var cmgInstances = window.__cmgGalleryInstances;
  if (!(cmgInstances instanceof Map)) {
    cmgInstances = new Map();
    window.__cmgGalleryInstances = cmgInstances;
  }


  function initCustomMediaGallery(blockId, rawData, mediaRadius, enableZoom) {
    var mediasData;
    try {
        var jsonStr = (typeof rawData === 'string') ? rawData : JSON.stringify(rawData);
        // 清理 trailing comma（对象和数组中最后一个元素后的逗号）
        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
        mediasData = JSON.parse(jsonStr);
    } catch (e) {
        console.warn('[custom-media-gallery] JSON parse error', e);
        return;
    }


    var medias = (mediasData && mediasData.medias) ? mediasData.medias : [];
    if (!medias.length) return;

    var galleryEl = document.getElementById('custom-media-gallery-' + blockId);
    var slideshowEl = document.getElementById('custom-media-slideshow-' + blockId);
    var thumbsEl = document.getElementById('custom-media-controls-' + blockId);
    if (!slideshowEl) return;

    var instanceKey = String(blockId);
    var oldInstance = cmgInstances.get(instanceKey);
    if (oldInstance) oldInstance.destroy();

    var galleryController = new AbortController();
    var spinInstances = new Set();
    var galleryDestroyed = false;
    var removalObserver = null;

    function destroySpins() {
      Array.from(spinInstances).forEach(function (spin) {
        spin.destroy();
      });
      spinInstances.clear();
    }

    var galleryInstance = {
      destroy: function () {
        if (galleryDestroyed) return;
        galleryDestroyed = true;

        destroySpins();
        galleryController.abort();

        if (removalObserver) removalObserver.disconnect();

        slideshowEl.querySelectorAll('video').forEach(function (video) {
          video.pause();
        });

        // 清理当前画廊创建的 Pairings 弹窗
        if (galleryEl) {
          galleryEl.querySelectorAll('.cmg-album').forEach(function (dialog) {
            if (dialog.open) dialog.close();

            dialog.querySelectorAll('video').forEach(function (video) {
              video.pause();
              video.removeAttribute('src');
              video.load();
            });

            dialog.remove();
          });
        }

        if (cmgInstances.get(instanceKey) === galleryInstance) {
          cmgInstances.delete(instanceKey);
        }
      }
    };

    cmgInstances.set(instanceKey, galleryInstance);

    // 页面局部更新移除旧画廊时，也销毁尚在加载中的实例
    removalObserver = new MutationObserver(function () {
      if (!slideshowEl.isConnected) galleryInstance.destroy();
    });

    removalObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('shopify:section:unload', function (event) {
      if (
        event.target === galleryEl ||
        event.target === slideshowEl ||
        event.target?.contains(slideshowEl)
      ) {
        galleryInstance.destroy();
      }
    }, { signal: galleryController.signal });


    // 默认开启；JS 入参或 DOM data-enable-zoom="false" 任一关闭则禁用
    var zoomEnabled = enableZoom !== false;
    if (galleryEl && galleryEl.getAttribute('data-enable-zoom') === 'false') {
      zoomEnabled = false;
    }

    var mediaGridEl = slideshowEl;
    var activeIndex = 0;
    var slideEls = [];

    function createMediaItem(index, extraClass) {
      var item = document.createElement('slideshow-slide');
      item.setAttribute('index', index);
      item.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
      item.className = 'product-media-container product-media-container--image' + (extraClass ? ' ' + extraClass : '') + (index === 0 ? ' is-active' : '');
      item.style.setProperty('--media-radius', mediaRadius + 'px');
      return item;
    }

    function openLightbox(url) {
      if (!zoomEnabled) return;
      if (typeof window.openLightbox === 'function') { window.openLightbox(url); }
      else { window.open(url, '_blank'); }
    }

    function openModelModal(url) {
      if (typeof window.openModelModal === 'function') { window.openModelModal(url); }
    }

    function injectDiamondImage(url) {
      if (typeof window.injectDiamondImage === 'function') { window.injectDiamondImage(url); }
      else { var el = document.getElementById('dpi-skin-diamond'); if (el) { el.src = url; el.style.opacity = '1'; } }
    }

    function getThumbSrc(media) {
      if (media.mediaType === 6) {
        var firstImage = cmgPairingResources(media).find(function (resource) {
          return !resource.isVideo;
        });
        return firstImage ? firstImage.url : '';
      }

      if (media.mediaType === 4) {
        return (media.url || '') +
          (media.imageName || '') +
          '1.' +
          (media.imageSuffix || 'webp');
      }

      if (media.previewImage) return media.previewImage;
      return media.url || '';
    }


    function setActive(index) {
      if (index < 0 || index >= slideEls.length) return;
      activeIndex = index;
      slideEls.forEach(function (slide, i) {
        var on = i === index;
        slide.classList.toggle('is-active', on);
        slide.setAttribute('aria-hidden', on ? 'false' : 'true');
      });
      if (thumbsEl) {
        var thumbs = thumbsEl.querySelectorAll('.cmg-thumb');
        thumbs.forEach(function (thumb, i) {
          var on = i === index;
          thumb.classList.toggle('is-active', on);
          thumb.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        var activeThumb = thumbs[index];
        if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
          activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }
      spinInstances.forEach(function (spin) {
        spin.sync();
      });

    }

    function buildThumbnails(list) {
      if (!thumbsEl) return;
      thumbsEl.innerHTML = '';
      list.forEach(function (media, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cmg-thumb' + (index === 0 ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
        btn.setAttribute('aria-label', 'Media ' + (index + 1));

        var src = getThumbSrc(media);
        if (src) {
          var img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          btn.appendChild(img);
        }

        if (media.mediaType === 4) {
          var badge = document.createElement('span');
          badge.className = 'cmg-thumb__badge';
          badge.textContent = '360°';
          btn.appendChild(badge);
        } else if (media.mediaType === 3) {
          var badge3d = document.createElement('span');
          badge3d.className = 'cmg-thumb__badge';
          badge3d.textContent = '3D';
          btn.appendChild(badge3d);
        }

        btn.addEventListener('click', function () {
          setActive(index);
        });
        thumbsEl.appendChild(btn);
      });
    }

    function bindSwipe() {
      var startX = 0;
      var startY = 0;
      var tracking = false;

      mediaGridEl.addEventListener(
        'touchstart',
        function (e) {
          if (!e.touches || !e.touches[0]) return;
          // 不要劫持 360 spin 的 canvas 拖拽
          if (e.target && e.target.tagName === 'CANVAS') return;
          tracking = true;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
        },
        {
          passive: true,
          signal: galleryController.signal
        }
      );

      mediaGridEl.addEventListener(
        'touchend',
        function (e) {
          if (!tracking) return;
          tracking = false;
          var touch = e.changedTouches && e.changedTouches[0];
          if (!touch) return;
          var dx = touch.clientX - startX;
          var dy = touch.clientY - startY;
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
          if (dx < 0) setActive(Math.min(activeIndex + 1, slideEls.length - 1));
          else setActive(Math.max(activeIndex - 1, 0));
        },
        {
          passive: true,
          signal: galleryController.signal
        }
      );
    }
    //画廊
    // ── mediaType 6: Popular Pairings + album ──
    function cmgPairingResources(media) {
      if (!Array.isArray(media && media.extraInfo)) return [];

      return media.extraInfo
        .filter(function (resource) {
          return resource &&
            typeof resource.url === 'string' &&
            resource.url.trim();
        })
        .map(function (resource) {
          var url = resource.url.trim();
          var isVideo = false;

          try {
            isVideo = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(
              new URL(url, window.location.href).pathname
            );
          } catch (_) {}

          return {
            url: url,
            alt: typeof resource.alt === 'string' ? resource.alt : '',
            isVideo: isVideo
          };
        });
    }

    var cmgPairingAlbum = null;

    function cmgEnsurePairingAlbum() {
      if (cmgPairingAlbum) return cmgPairingAlbum;

      var dialog = document.createElement('dialog');
      dialog.className = 'cmg-album';
      dialog.id = 'cmg-album-' + blockId;
      dialog.setAttribute('aria-label', 'Popular Pairings gallery');

      dialog.innerHTML = `
        <div class="cmg-album__panel">
          <button type="button" class="cmg-album__close"
            aria-label="Close gallery">×</button>
          <div class="cmg-album__stage"></div>
          <button type="button"
            class="cmg-album__arrow cmg-album__prev"
            aria-label="Previous media"><span>‹</span></button>
          <button type="button"
            class="cmg-album__arrow cmg-album__next"
            aria-label="Next media"><span>›</span></button>
          <div class="cmg-album__caption" aria-live="polite"></div>
          <div class="cmg-album__thumbs"
            aria-label="Gallery previews"></div>
        </div>
      `;

      // 不放到 slideshow 内，避免受手机端隐藏 slide 的规则影响。
      galleryEl.appendChild(dialog);

      var stage = dialog.querySelector('.cmg-album__stage');
      var caption = dialog.querySelector('.cmg-album__caption');
      var thumbs = dialog.querySelector('.cmg-album__thumbs');
      var previous = dialog.querySelector('.cmg-album__prev');
      var next = dialog.querySelector('.cmg-album__next');

      var resources = [];
      var currentIndex = 0;
      var returnFocus = null;
      var previousOverflow = '';

      function clearStage() {
        stage.querySelectorAll('video').forEach(function (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        });
        stage.replaceChildren();
      }

      function show(index) {
        if (!resources.length) return;

        currentIndex = (index + resources.length) % resources.length;
        var resource = resources[currentIndex];

        clearStage();

        var element = document.createElement(
          resource.isVideo ? 'video' : 'img'
        );

        if (resource.isVideo) {
          element.controls = true;
          element.playsInline = true;
          element.preload = 'metadata';
          element.setAttribute(
            'aria-label',
            resource.alt || 'Video ' + (currentIndex + 1)
          );
        } else {
          element.alt = resource.alt || 'Pairing ' + (currentIndex + 1);
        }

        element.src = resource.url;
        stage.appendChild(element);

        caption.textContent =
          (currentIndex + 1) + ' / ' + resources.length +
          (resource.alt ? ' · ' + resource.alt : '');

        Array.from(thumbs.children).forEach(function (button, index) {
          var active = index === currentIndex;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });

        var activeThumb = thumbs.children[currentIndex];
        if (activeThumb) {
          activeThumb.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
          });
        }
      }

      function open(items, index, trigger) {
        resources = items;
        if (!resources.length) return;

        returnFocus = trigger || document.activeElement;
        thumbs.replaceChildren();

        resources.forEach(function (resource, resourceIndex) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'cmg-album__thumb';
          button.setAttribute(
            'aria-label',
            'Show ' + (resource.isVideo ? 'video ' : 'image ') +
            (resourceIndex + 1)
          );

          var preview = document.createElement(
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
            var badge = document.createElement('span');
            badge.className = 'cmg-album__video-badge';
            badge.textContent = '▶';
            button.appendChild(badge);
          }

          button.addEventListener('click', function () {
            show(resourceIndex);
          });

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

      dialog.querySelector('.cmg-album__close')
        .addEventListener('click', function () {
          dialog.close();
        });

      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
      });

      previous.addEventListener('click', function () {
        show(currentIndex - 1);
      });

      next.addEventListener('click', function () {
        show(currentIndex + 1);
      });

      dialog.addEventListener('keydown', function (event) {
        if (event.target.closest('video')) return;

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          show(currentIndex - 1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          show(currentIndex + 1);
        }
      });

      // Escape 关闭由原生 dialog 处理。
      dialog.addEventListener('close', function () {
        clearStage();

        thumbs.querySelectorAll('video').forEach(function (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        });

        thumbs.replaceChildren();
        resources = [];
        document.documentElement.style.overflow = previousOverflow;

        if (returnFocus && returnFocus.isConnected) {
          returnFocus.focus();
        }
      });

      cmgPairingAlbum = { open: open };
      return cmgPairingAlbum;
    }

    function renderPairings(media, index) {
      var resources = cmgPairingResources(media);

      // 保存完整数组里的索引，不能使用过滤图片后的索引打开图册。
      var pictures = resources
        .map(function (resource, resourceIndex) {
          return { resource: resource, index: resourceIndex };
        })
        // .filter(function (entry) {
        //   return !entry.resource.isVideo;
        // })
        .slice(0, 4);

      if (!pictures.length) return;

      var item = createMediaItem(index, 'cmg-pairings-slide');
      var wrapper = document.createElement('div');
      wrapper.className = 'cmg-pairings';

      var title = document.createElement('div');
      title.className = 'cmg-pairings__title';
      title.textContent = 'Popular Pairings';

      var grid = document.createElement('div');
      grid.className = 'cmg-pairings__grid';

      pictures.forEach(function (entry, pictureIndex) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'cmg-pairings__card';
        button.setAttribute(
          'aria-label',
          entry.resource.alt || 'Open pairing ' + (pictureIndex + 1)
        );
        button.setAttribute('aria-haspopup', 'dialog');

        var preview = document.createElement(
          entry.resource.isVideo ? 'video' : 'img'
        );

        if (entry.resource.isVideo) {
          preview.muted = true;
          preview.playsInline = true;
          preview.preload = 'metadata';
          preview.setAttribute('aria-hidden', 'true');
        } else {
          preview.alt = entry.resource.alt || '';
          preview.loading = 'lazy';
        }

        preview.src = entry.resource.url;
        preview.style.cssText =
          'display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;';
        button.appendChild(preview);

        if (entry.resource.isVideo) {
          var badge = document.createElement('span');
          badge.textContent = '▶';
          badge.setAttribute('aria-hidden', 'true');
          badge.style.cssText =
            'position:absolute;right:8px;bottom:8px;z-index:1;' +
            'display:grid;place-items:center;width:28px;height:28px;line-height: 28px;' +
            'border-radius:50%;background:rgba(0,0,0,.55);color:#fff;' +
            'font-size:13px;pointer-events:none;';
          button.appendChild(badge);
        }


        if (pictureIndex === 3) {
          var more = document.createElement('span');
          more.className = 'cmg-pairings__more';
          more.textContent = 'View More';
          button.appendChild(more);
        }

        button.addEventListener('click', function (event) {
          event.stopPropagation();
          cmgEnsurePairingAlbum().open(
            resources,
            entry.index,
            button
          );
        });

        grid.appendChild(button);
      });

      wrapper.append(title, grid);
      item.appendChild(wrapper);
      mediaGridEl.appendChild(item);

      // 必须加入现有 slideEls，手机缩略图才能正确切换。
      slideEls.push(item);
    }

    //end画廊

    function renderImage(media, index) {
      var item = createMediaItem(index, 'dpi-media-item--product');
      var img = document.createElement('img');
      img.src = media.url;
      img.alt = '';
      img.loading = index === 0 ? 'eager' : 'lazy';
      img.className = 'product-media__image';
      img.style.cssText = (zoomEnabled ? 'cursor:zoom-in;' : 'cursor:default;') + 'width:100%;height:100%;object-fit:cover;';
      if (zoomEnabled) {
        img.addEventListener('click', function () { openLightbox(media.url); });
      }
      item.appendChild(img);
      if (media.extraInfo) {
        var label = document.createElement('div');
        label.className = 'dpi-media-label';
        label.textContent = media.extraInfo;
        item.appendChild(label);
      }
      mediaGridEl.appendChild(item);
      slideEls.push(item);
    }

    function renderVideo(media, index) {
      var item = createMediaItem(index);
      item.className += ' product-media-container--video';
      var video = document.createElement('video');
      video.src = media.url;
      video.poster = media.previewImage || '';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      video.addEventListener('mouseenter', function () { video.play(); });
      video.addEventListener('mouseleave', function () { video.pause(); video.currentTime = 0; });
      item.appendChild(video);
      mediaGridEl.appendChild(item);
      slideEls.push(item);
    }

    function renderModel(media, index) {
      var item = createMediaItem(index, 'dpi-media-item--product');
      item.className += ' product-media-container--model';
      var preview = document.createElement('img');
      preview.src = media.previewImage || '';
      preview.alt = '3D Model';
      preview.loading = 'lazy';
      preview.style.cssText = 'cursor:pointer;width:100%;height:100%;object-fit:cover;';
      preview.addEventListener('click', function () { openModelModal(media.url); });
      var badge = document.createElement('div');
      badge.className = 'dpi-thumb__badge';
      badge.textContent = '3D';
      item.appendChild(preview);
      item.appendChild(badge);
      mediaGridEl.appendChild(item);
      slideEls.push(item);
    }

        function renderSpin(media, index) {
      const item = createMediaItem(index, 'dpi-media-item--product');
      const totalFrames = Math.max(
        1,
        Math.floor(Number(media.imageNumber) || 1)
      );

      // 保留原来的旋转参数
      const SENSITIVITY = 1.0;
      const AUTO_PLAY_SPEED = 0.5;
      const FRICTION = 0.90;
      const SPEED_BOOST = 2.5;
      const MAX_INERTIA = 0.8;

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 800;
      canvas.style.cssText =
        'width:100%;height:100%;object-fit:contain;cursor:grab;' +
        'display:block;transform:translateZ(0);touch-action:none;';

      const loader = document.createElement('div');
      loader.className = 'dpi-spin-loader';
      loader.innerHTML = `
        <span class="cmg-spin-progress-text">Loading…</span>
        <div style="width:160px;height:5px;background:#e0e0e0;border-radius:3px;margin-top:10px;overflow:hidden;">
          <div class="cmg-spin-progress-bar"
            style="width:0%;height:100%;background:#1a3a4a;transition:width 0.1s;"></div>
        </div>
      `;

      const dragLabel = document.createElement('div');
      dragLabel.className = 'dpi-drag-label';
      dragLabel.textContent = 'Drag to Spin';

      item.append(canvas, loader, dragLabel);
      mediaGridEl.appendChild(item);
      slideEls.push(item);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        loader.style.display = 'none';
        return;
      }

      // 不使用全局 ID，避免多个画廊之间互相命中
      const progressText = loader.querySelector('.cmg-spin-progress-text');
      const progressBar = loader.querySelector('.cmg-spin-progress-bar');
      const controller = new AbortController();
      const imgs = new Array(totalFrames);

      let disposed = false;
      let rafId = null;
      let loaderTimer = null;
      let loadedCount = 0;
      let isReady = false;
      let firstFrameShown = false;
      let currentFrameFloat = 0;
      let lastRenderedFrame = -1;
      let lastAnimationTime = 0;
      let isDragging = false;
      let isMouseOver = false;
      let startX = 0;
      let startFrameFloat = 0;
      let trackX = 0;
      let trackTime = 0;
      let finalVelocity = 0;
      let inertiaSpeed = 0;

      function listen(target, type, handler, options = {}) {
        target.addEventListener(type, handler, {
          ...options,
          signal: controller.signal
        });
      }

      function isActive() {
        // 手机隐藏的 slide 不运行动画。
        // 桌面若所有 slide 以网格显示，则允许可见的旋转运行。
        return !document.hidden &&
          item.isConnected &&
          item.getClientRects().length > 0 &&
          getComputedStyle(item).visibility !== 'hidden';
      }

      function stopAnimation() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        lastAnimationTime = 0;
      }

      function syncPlayback() {
        if (disposed || !isReady) return;

        if (!isActive()) {
          stopAnimation();
          isDragging = false;
          isMouseOver = false;
          canvas.style.cursor = 'grab';
          return;
        }

        if (rafId === null) {
          lastAnimationTime = 0;
          rafId = requestAnimationFrame(animate);
        }
      }

      const instance = {
        sync: syncPlayback,

        destroy: function () {
          if (disposed) return;
          disposed = true;
          isReady = false;
          isDragging = false;

          stopAnimation();
          if (loaderTimer !== null) clearTimeout(loaderTimer);
          controller.abort();

          imgs.forEach(function (img) {
            if (!img) return;
            img.onload = null;
            img.onerror = null;
            img.removeAttribute('src');
          });
          imgs.length = 0;

          canvas.width = 1;
          canvas.height = 1;

          spinInstances.delete(instance);
        }
      };

      spinInstances.add(instance);

      function clampFrame(value) {
        return (value % totalFrames + totalFrames) % totalFrames;
      }

      function renderFrame(value) {
        if (disposed) return;

        const frame = Math.round(clampFrame(value)) % totalFrames;
        if (frame === lastRenderedFrame) return;

        const img = imgs[frame];
        if (!img || !img.complete || img.naturalWidth <= 0) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        lastRenderedFrame = frame;
      }

      function showInitialFrame(index) {
        const img = imgs[index];
        if (!img || img.naturalWidth <= 0) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        currentFrameFloat = index;
        lastRenderedFrame = -1;
        renderFrame(index);
        firstFrameShown = true;
      }

      function onFrameSettled() {
        if (disposed) return;

        loadedCount++;
        const percentage = Math.floor(loadedCount / totalFrames * 100);
        progressText.textContent = percentage + '%';
        progressBar.style.width = percentage + '%';

        if (loadedCount !== totalFrames) return;

        if (!firstFrameShown) {
          const fallbackIndex = imgs.findIndex(function (img) {
            return img && img.complete && img.naturalWidth > 0;
          });
          if (fallbackIndex >= 0) showInitialFrame(fallbackIndex);
        }

        isReady = imgs.some(function (img) {
          return img && img.complete && img.naturalWidth > 0;
        });

        if (!isReady) {
          progressText.textContent = 'Unable to load spin';
          dragLabel.style.display = 'none';
          return;
        }

        loader.style.opacity = '0';
        loaderTimer = setTimeout(function () {
          if (!disposed) loader.style.display = 'none';
        }, 300);

        syncPlayback();
      }

      function animate(now) {
        rafId = null;
        if (disposed) return;

        if (!canvas.isConnected) {
          instance.destroy();
          return;
        }

        if (!isActive()) {
          lastAnimationTime = 0;
          return;
        }

        if (!lastAnimationTime) lastAnimationTime = now;
        const deltaTime = Math.min(
          Math.max((now - lastAnimationTime) / 16.667, 0),
          2
        );
        lastAnimationTime = now;

        if (!isDragging && isReady) {
          if (inertiaSpeed !== 0) {
            currentFrameFloat -= inertiaSpeed * deltaTime;
            inertiaSpeed *= Math.pow(FRICTION, deltaTime);

            if (Math.abs(inertiaSpeed) < 0.02) inertiaSpeed = 0;
          }

          if (inertiaSpeed === 0 && !isMouseOver) {
            currentFrameFloat += AUTO_PLAY_SPEED * deltaTime;
          }

          currentFrameFloat = clampFrame(currentFrameFloat);
          renderFrame(currentFrameFloat);
        }

        rafId = requestAnimationFrame(animate);
      }

      function handleStart(event) {
        if (disposed || !isReady || !isActive()) return;

        isDragging = true;
        inertiaSpeed = 0;
        finalVelocity = 0;
        dragLabel.style.opacity = '0';
        canvas.style.cursor = 'grabbing';

        const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
        startX = clientX;
        startFrameFloat = currentFrameFloat;
        trackX = clientX;
        trackTime = performance.now();
      }

      function handleMove(event) {
        if (disposed || !isDragging) return;
        if (event.cancelable) event.preventDefault();

        const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
        const now = performance.now();

        currentFrameFloat = clampFrame(
          startFrameFloat - (clientX - startX) / SENSITIVITY
        );
        renderFrame(currentFrameFloat);

        const dt = now - trackTime;
        if (dt > 0) {
          finalVelocity =
            finalVelocity * 0.75 +
            ((clientX - trackX) / dt) * 0.25;
          trackX = clientX;
          trackTime = now;
        }
      }

      function handleEnd() {
        if (disposed || !isDragging) return;

        isDragging = false;
        canvas.style.cursor = 'grab';
        inertiaSpeed = Math.max(
          -MAX_INERTIA,
          Math.min(MAX_INERTIA, finalVelocity * SPEED_BOOST)
        );
        finalVelocity = 0;
      }

      listen(item, 'mouseenter', function () {
        isMouseOver = true;
      });
      listen(item, 'mouseleave', function () {
        isMouseOver = false;
        dragLabel.style.opacity = '1';
        handleEnd();
      });

      listen(canvas, 'mousedown', handleStart);
      listen(window, 'mousemove', handleMove);
      listen(window, 'mouseup', handleEnd);

      listen(canvas, 'touchstart', function (event) {
        isMouseOver = true;
        handleStart(event);
        event.stopPropagation();
      }, { passive: false });

      listen(canvas, 'touchmove', function (event) {
        handleMove(event);
        event.stopPropagation();
      }, { passive: false });

      function finishTouch() {
        isMouseOver = false;
        handleEnd();
      }

      listen(window, 'touchend', finishTouch);
      listen(window, 'touchcancel', finishTouch);
      listen(document, 'visibilitychange', syncPlayback);
      listen(window, 'resize', syncPlayback);

      for (let index = 0; index < totalFrames; index++) {
        const img = new Image();
        imgs[index] = img;

        img.onload = function () {
          if (disposed) return;
          if (index === 0 && !firstFrameShown) showInitialFrame(0);
          onFrameSettled();
        };

        img.onerror = function () {
          if (!disposed) onFrameSettled();
        };

        img.src = media.url + media.imageName +
          (index + 1) + '.' + media.imageSuffix;
      }
    }

    function renderSkinTone(media, index) {
        return;
      var item = createMediaItem(index, 'dpi-media-item--skin-tone');
      var skinToneEl = document.getElementById('dpi-skin-tone-data');
      var imgDarkSrc = skinToneEl ? skinToneEl.dataset.imgDark : '';
      var imgMediumSrc = skinToneEl ? skinToneEl.dataset.imgMedium : '';
      var imgLightSrc = skinToneEl ? skinToneEl.dataset.imgLight : '';
      item.innerHTML =
        '<div class="dpi-skin-tone__images">' +
        '<img class="dpi-skin-tone__img dpi-skin-tone__img--dark" src="' + imgDarkSrc + '" alt="Dark skin tone" loading="lazy" style="opacity:0;">' +
        '<img class="dpi-skin-tone__img dpi-skin-tone__img--medium" src="' + imgMediumSrc + '" alt="Medium skin tone" loading="lazy" style="opacity:1;">' +
        '<img class="dpi-skin-tone__img dpi-skin-tone__img--light" src="' + imgLightSrc + '" alt="Light skin tone" loading="lazy" style="opacity:0;">' +
        '<img class="dpi-skin-tone__img dpi-skin-tone__img--diamond" id="dpi-skin-diamond" src="" alt="Diamond" style="opacity:0;z-index:1;pointer-events:none;object-fit:contain;">' +
        '</div>' +
        '<div class="dpi-skin-tone__slider-wrap">' +
        '<span class="dpi-skin-tone__label dpi-skin-tone__label--top">Lighter</span>' +
        '<div class="dpi-skin-tone__track"><input class="dpi-skin-tone__range" type="range" min="0" max="100" value="50" step="1" orient="vertical"></div>' +
        '<span class="dpi-skin-tone__label dpi-skin-tone__label--bottom">Darker</span>' +
        '</div>';
      mediaGridEl.appendChild(item);

      var range = item.querySelector('.dpi-skin-tone__range');
      var imgDark = item.querySelector('.dpi-skin-tone__img--dark');
      var imgMedium = item.querySelector('.dpi-skin-tone__img--medium');
      var imgLight = item.querySelector('.dpi-skin-tone__img--light');

      function updateOpacity(val) {
        var v = Number(val), oDark, oMedium, oLight;
        if (v <= 50) { var t = v / 50; oDark = 1 - t; oMedium = t; oLight = 0; }
        else { var t2 = (v - 50) / 50; oDark = 0; oMedium = 1 - t2; oLight = t2; }
        if (imgDark) imgDark.style.opacity = oDark;
        if (imgMedium) imgMedium.style.opacity = oMedium;
        if (imgLight) imgLight.style.opacity = oLight;
      }

      updateOpacity(range.value);
      range.addEventListener('input', function (e) { updateOpacity(e.target.value); });
    }

    function populateMedia(medias) {
      if (galleryDestroyed) return;

      destroySpins();

      mediaGridEl.querySelectorAll('video').forEach(function (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });

      mediaGridEl.innerHTML = '';

      slideEls = [];
      if (!medias || medias.length === 0) {
        mediaGridEl.innerHTML = '<div style="padding:40px;color:#aaa;text-align:center;">No media available</div>';
        return;
      }
      medias.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      // ── 提取 mediaType 5 钻石图并注入皮肤叠加层 ──
      var diamondMedia = medias.find(function (m) { return m.mediaType === 5; });
      var visibleMedias = [];
      
      medias.forEach(function (media) {
        if (
          media.mediaType === 6 &&
          cmgPairingResources(media).length === 0
        ) {
          return;
        }

        if (media.mediaType === 5) {
          renderSkinTone(media, visibleMedias.length);
          return;
        }

        var index = visibleMedias.length;
        visibleMedias.push(media);

        switch (media.mediaType) {
          case 1: renderImage(media, index); break;
          case 2: renderVideo(media, index); break;
          case 3: renderModel(media, index); break;
          case 4: renderSpin(media, index); break;
          case 6: renderPairings(media, index); break;
          default: renderImage(media, index);
        }
      });

      
      if (diamondMedia) injectDiamondImage(diamondMedia.url);

      // 手机端缩略图：点击切换主图
      buildThumbnails(visibleMedias);
      setActive(0);
     
    }
    bindSwipe();
    populateMedia(medias);

    if (galleryEl) {
      galleryEl.classList.add('cmg-ready');
      initMobileShapeViewer(galleryEl);
    }
  }

  function initMobileShapeViewer(root) {
    var viewer = (root || document).querySelector('.cmg-shape-viewer');
    if (!viewer || viewer.dataset.bound === 'true') return;
    viewer.dataset.bound = 'true';

    var trigger = viewer.querySelector('.cmg-shape-viewer__trigger');
    var panel = viewer.querySelector('.cmg-shape-viewer__panel');
    var labelEl = viewer.querySelector('.cmg-shape-viewer__label');
    var iconEl = viewer.querySelector('.cmg-shape-viewer__icon');
    if (!trigger || !panel) return;

    function setOpen(open) {
      viewer.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }

    function findShapeInput(value, optionValueId) {
      var picker = document.querySelector('variant-picker');
      if (!picker) return null;
      var shapeRow = picker.querySelector('.variant-option--shape-row') || picker;
      var inputs = shapeRow.querySelectorAll('input[type="radio"]');
      var match = null;
      inputs.forEach(function (input) {
        if (optionValueId && input.dataset.optionValueId === String(optionValueId)) {
          match = input;
          return;
        }
        if (!match && input.value === value) match = input;
      });
      return match;
    }

    function selectShape(btn) {
      var value = btn.getAttribute('data-shape-value') || '';
      var optionValueId = btn.getAttribute('data-option-value-id') || '';
      var connectedUrl = btn.getAttribute('data-connected-product-url') || '';
      var img = btn.querySelector('img');

      panel.querySelectorAll('.cmg-shape-viewer__option').forEach(function (opt) {
        var on = opt === btn;
        opt.classList.toggle('is-selected', on);
        opt.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      if (labelEl) labelEl.textContent = value;
      if (img) {
        if (iconEl) {
          iconEl.src = img.src;
          iconEl.hidden = false;
        } else {
          iconEl = document.createElement('img');
          iconEl.className = 'cmg-shape-viewer__icon';
          iconEl.alt = '';
          iconEl.width = 18;
          iconEl.height = 18;
          iconEl.src = img.src;
          trigger.insertBefore(iconEl, labelEl || trigger.firstChild);
        }
      }

      var input = findShapeInput(value, optionValueId);
      if (input) {
        if (!input.checked) input.click();
      } else if (connectedUrl) {
        window.location.href = connectedUrl;
      }

      setOpen(false);
    }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!viewer.classList.contains('is-open'));
    });

    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('.cmg-shape-viewer__option');
      if (!btn) return;
      e.preventDefault();
      selectShape(btn);
    });

    document.addEventListener('click', function (e) {
      if (!viewer.classList.contains('is-open')) return;
      if (viewer.contains(e.target)) return;
      setOpen(false);
    });
  }

  window.initCustomMediaGallery = initCustomMediaGallery;
  window.initMobileShapeViewer = initMobileShapeViewer;
})();
