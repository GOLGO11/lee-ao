(function () {
  'use strict';

  var CONTENT_CACHE = 'leeao-mdbook-content-v1';
  var STATE_KEY = 'leeao-mdbook-offline-state-v1';
  var deferredInstallPrompt = null;
  var isDownloading = false;
  var shouldStop = false;
  var els = {};

  var currentScript = document.currentScript;
  var scriptUrl = currentScript ? new URL(currentScript.src) : new URL('pwa/pwa.js', window.location.href);
  var rootUrl = new URL('../', scriptUrl);

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    setStatus('已安装到桌面。');
    updateInstallButton();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    registerServiceWorker();
    createWidget();
    updateInstallButton();
    refreshOfflineStatus();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    var swUrl = new URL('sw.js', rootUrl);
    navigator.serviceWorker.register(swUrl, { scope: rootUrl.pathname }).catch(function (error) {
      console.warn('Service worker registration failed:', error);
    });
  }

  function createWidget() {
    if (document.querySelector('.leeao-pwa-widget')) return;

    var widget = document.createElement('div');
    widget.className = 'leeao-pwa-widget';
    widget.innerHTML = [
      '<button class="leeao-pwa-toggle" type="button" aria-expanded="false">离线</button>',
      '<div class="leeao-pwa-panel" hidden>',
      '  <p class="leeao-pwa-title">桌面与离线书库</p>',
      '  <p class="leeao-pwa-status">正在检查离线状态...</p>',
      '  <div class="leeao-pwa-progress" aria-hidden="true"><div class="leeao-pwa-progress-bar"></div></div>',
      '  <div class="leeao-pwa-actions">',
      '    <button class="leeao-pwa-button primary" type="button" data-action="download">下载离线书库</button>',
      '    <button class="leeao-pwa-button" type="button" data-action="install">安装到桌面</button>',
      '    <button class="leeao-pwa-button" type="button" data-action="clear">清除离线</button>',
      '    <button class="leeao-pwa-button" type="button" data-action="close">关闭</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(widget);

    els.widget = widget;
    els.toggle = widget.querySelector('.leeao-pwa-toggle');
    els.panel = widget.querySelector('.leeao-pwa-panel');
    els.status = widget.querySelector('.leeao-pwa-status');
    els.progress = widget.querySelector('.leeao-pwa-progress-bar');
    els.download = widget.querySelector('[data-action="download"]');
    els.install = widget.querySelector('[data-action="install"]');
    els.clear = widget.querySelector('[data-action="clear"]');
    els.close = widget.querySelector('[data-action="close"]');

    els.toggle.addEventListener('click', function () {
      var open = els.panel.hidden;
      els.panel.hidden = !open;
      els.toggle.setAttribute('aria-expanded', String(open));
      if (open) refreshOfflineStatus();
    });

    els.download.addEventListener('click', handleDownloadClick);
    els.install.addEventListener('click', handleInstallClick);
    els.clear.addEventListener('click', clearOfflineLibrary);
    els.close.addEventListener('click', function () {
      els.panel.hidden = true;
      els.toggle.setAttribute('aria-expanded', 'false');
    });
  }

  async function handleInstallClick() {
    if (isStandalone()) {
      setStatus('当前已经是桌面应用模式。');
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }

    if (isIosSafari()) {
      setStatus('请点 Safari 的分享按钮，再选择“添加到主屏幕”。');
      return;
    }

    setStatus('请打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。');
  }

  async function handleDownloadClick() {
    if (isDownloading) {
      shouldStop = true;
      setStatus('正在停止下载...');
      return;
    }

    if (!('caches' in window)) {
      setStatus('当前浏览器不支持离线缓存。');
      return;
    }

    isDownloading = true;
    shouldStop = false;
    els.download.textContent = '停止下载';
    els.clear.disabled = true;

    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }

      var manifest = await loadOfflineManifest();
      var cache = await caches.open(CONTENT_CACHE);
      var oldState = readState();
      var shouldRefresh = oldState.version !== manifest.version;
      var done = 0;
      var failed = 0;
      var total = manifest.files.length;

      for (var i = 0; i < total; i += 1) {
        if (shouldStop) break;

        var file = manifest.files[i];
        var url = new URL(file, rootUrl);
        var cached = await cache.match(url.href);

        if (cached && !shouldRefresh) {
          done += 1;
          updateProgress(done, total, failed);
          continue;
        }

        try {
          var response = await fetch(url.href, { cache: 'reload' });
          if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
          await cache.put(url.href, response.clone());
          done += 1;
        } catch (error) {
          failed += 1;
          console.warn('Offline cache failed:', url.href, error);
        }

        updateProgress(done, total, failed);
      }

      if (shouldStop) {
        saveState({ version: manifest.version, total: total, done: done, failed: failed, stoppedAt: Date.now() });
        setStatus('下载已停止，已保存当前进度。');
      } else if (failed > 0) {
        saveState({ version: manifest.version, total: total, done: done, failed: failed, updatedAt: Date.now() });
        setStatus('离线书库下载完成，但有 ' + failed + ' 个文件失败。网络稳定后可再点一次继续。');
      } else {
        saveState({ version: manifest.version, total: total, done: done, failed: 0, updatedAt: Date.now() });
        setProgress(100);
        setStatus('离线书库已下载完成。');
      }
    } catch (error) {
      console.error(error);
      setStatus('下载失败：' + (error.message || '请稍后重试'));
    } finally {
      isDownloading = false;
      shouldStop = false;
      els.clear.disabled = false;
      updateDownloadButtonText();
    }
  }

  async function clearOfflineLibrary() {
    if (isDownloading) return;
    if (!('caches' in window)) return;

    await caches.delete(CONTENT_CACHE);
    localStorage.removeItem(STATE_KEY);
    setProgress(0);
    setStatus('离线书库已清除。');
  }

  async function refreshOfflineStatus(quiet) {
    if (!els.status || isDownloading) return;

    try {
      var manifest = await loadOfflineManifest();
      var state = readState();
      var estimate = await getStorageEstimate();

      if (state.version === manifest.version && state.done >= manifest.files.length && !state.failed) {
        setProgress(100);
        setStatus('离线书库已就绪，共 ' + manifest.files.length + ' 个文件。' + estimate);
        updateDownloadButtonText();
        return;
      }

      if (state.done) {
        setProgress(Math.round(state.done / Math.max(state.total || manifest.files.length, 1) * 100));
        setStatus('已缓存 ' + state.done + ' / ' + (state.total || manifest.files.length) + ' 个文件。' + estimate);
        return;
      }

      setProgress(0);
      setStatus('可下载完整离线书库，共 ' + manifest.files.length + ' 个文件。' + estimate);
      updateDownloadButtonText();
    } catch (error) {
      if (!quiet) setStatus('暂时无法读取离线清单。');
    }
  }

  async function loadOfflineManifest() {
    var response = await fetch(new URL('offline-files.json', rootUrl).href, { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取 offline-files.json');
    return response.json();
  }

  async function getStorageEstimate() {
    if (!navigator.storage || !navigator.storage.estimate) return '';
    var estimate = await navigator.storage.estimate();
    if (!estimate.quota || !estimate.usage) return '';
    return ' 当前已用约 ' + formatBytes(estimate.usage) + '。';
  }

  function updateProgress(done, total, failed) {
    var percent = Math.round(done / Math.max(total, 1) * 100);
    setProgress(percent);
    setStatus('正在下载离线书库：' + done + ' / ' + total + (failed ? '，失败 ' + failed : ''));
  }

  function setProgress(percent) {
    if (els.progress) els.progress.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }

  function setStatus(message) {
    if (els.status) els.status.textContent = message;
  }

  function updateInstallButton() {
    if (!els.install) return;
    if (isStandalone()) {
      els.install.disabled = true;
      els.install.textContent = '已安装';
    } else {
      els.install.disabled = false;
      els.install.textContent = '安装到桌面';
    }
  }

  function updateDownloadButtonText() {
    if (!els.download || isDownloading) return;
    var state = readState();
    els.download.textContent = state.total && state.done >= state.total && !state.failed
      ? '更新离线书库'
      : '下载离线书库';
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isIosSafari() {
    var ua = window.navigator.userAgent;
    var isIos = /iPad|iPhone|iPod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    var isWebKit = /WebKit/.test(ua);
    var isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIos && isWebKit && !isOtherIosBrowser;
  }

  function formatBytes(bytes) {
    if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
    if (bytes > 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return bytes + 'B';
  }
})();
