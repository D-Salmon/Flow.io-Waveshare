(function () {
  var versionKey = 'flow_web_asset_version';
  var themeKey = 'flow_web_theme';
  var scriptLoads = new Map();
  var cssLoads = new Map();
  var prefetchedAssets = new Set();
  var csrfToken = '';

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function parseRetryAfterMs(value, fallbackMs) {
    var raw = String(value || '').trim();
    if (!raw) return fallbackMs;
    var sec = Number(raw);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.max(120, Math.min(10000, Math.round(sec * 1000)));
    }
    var ts = Date.parse(raw);
    if (Number.isFinite(ts)) {
      return Math.max(120, Math.min(10000, ts - Date.now()));
    }
    return fallbackMs;
  }

  function setBootStatus(text, isError) {
    var bootStatus = document.getElementById('bootStatus');
    if (!bootStatus) {
      var root = document.getElementById('app-root');
      if (!root) return;
      root.className = 'is-booting';
      root.innerHTML = '';
      bootStatus = document.createElement('div');
      bootStatus.id = 'bootStatus';
      root.appendChild(bootStatus);
    }
    bootStatus.textContent = text;
    bootStatus.className = isError ? 'boot-status error' : 'boot-status';
  }

  function getStoredVersion() {
    try {
      return String(localStorage.getItem(versionKey) || '').trim();
    } catch (err) {
      return '';
    }
  }

  function storeVersion(version) {
    if (!version) return;
    try {
      localStorage.setItem(versionKey, version);
    } catch (err) {}
  }

  function readStoredTheme() {
    try {
      return localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
    } catch (err) {
      return 'light';
    }
  }

  function applyStoredTheme() {
    var theme = readStoredTheme();
    try {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;
    } catch (err) {}
    return theme;
  }

  function assetUrl(path, version) {
    if (!version) return path;
    return path + '?v=' + encodeURIComponent(version);
  }

  function ingestSecurityMeta(meta) {
    var token = meta && typeof meta.csrf_token === 'string' ? meta.csrf_token.trim() : '';
    if (/^[0-9a-f]{32}$/i.test(token)) csrfToken = token;
  }

  function secureFetchOptions(options) {
    var secured = Object.assign({}, options || {});
    var method = String(secured.method || 'GET').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      var headers = new Headers(secured.headers || {});
      if (csrfToken) headers.set('X-Flow-CSRF', csrfToken);
      secured.headers = headers;
    }
    return secured;
  }

  function isMutatingMethod(options) {
    var method = String(options && options.method || 'GET').toUpperCase();
    return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  }

  async function refreshCsrfToken() {
    var response = await fetch('/api/web/meta', { cache: 'no-store' });
    if (!response.ok) return false;
    var meta = await response.json().catch(function () { return null; });
    var previousToken = csrfToken;
    ingestSecurityMeta(meta);
    if (meta && meta.ok === true) window.__FLOW_WEB_META__ = meta;
    return csrfToken.length === 32 && csrfToken !== previousToken;
  }

  async function csrfAwareMutationFetch(url, options, fetchImpl) {
    var request = typeof fetchImpl === 'function' ? fetchImpl : fetch;
    var response = await request(url, secureFetchOptions(options));
    if (response.status !== 403 || !isMutatingMethod(options)) return response;
    var rejected = await response.clone().json().catch(function () { return null; });
    var rejectedCode = rejected && rejected.err && String(rejected.err.code || '');
    if (rejectedCode !== 'CsrfRejected' || !await refreshCsrfToken()) return response;
    return request(url, secureFetchOptions(options));
  }

  async function supervisorFetch(url, options, policy) {
    var cfg = policy || {};
    var retries = Number.isFinite(cfg.retries) ? cfg.retries : 4;
    var backoff = Array.isArray(cfg.backoffMs) && cfg.backoffMs.length
      ? cfg.backoffMs.slice()
      : [300, 700, 1500, 2600];

    var lastError = null;
    var csrfRefreshAttempted = false;
    for (var attempt = 0; attempt <= retries; attempt += 1) {
      try {
        var response = await fetch(url, secureFetchOptions(options));
        if (response.status === 401 && !String(url || '').startsWith('/api/auth/')) {
          window.location.replace('/login');
          return response;
        }
        if (response.status === 403 && !csrfRefreshAttempted && isMutatingMethod(options)) {
          var rejected = await response.clone().json().catch(function () { return null; });
          var rejectedCode = rejected && rejected.err && String(rejected.err.code || '');
          if (rejectedCode === 'CsrfRejected') {
            csrfRefreshAttempted = true;
            if (await refreshCsrfToken()) continue;
          }
        }
        if (response.status !== 503) return response;
        if (attempt >= retries) return response;
        var retryAfterHeader = response.headers ? response.headers.get('Retry-After') : '';
        var fallback = backoff[Math.min(attempt, backoff.length - 1)] || 1200;
        var waitMs = parseRetryAfterMs(retryAfterHeader, fallback);
        // A transient 503 can also occur while an already loaded page fetches
        // data for a menu. Do not replace the complete application in that
        // case: the retry should remain invisible and the current page must
        // stay usable.
        if (window.__FLOW_WEB_APP_READY__ !== true) {
          setBootStatus('Appareil occupé, nouvelle tentative...');
        }
        await sleep(waitMs);
      } catch (err) {
        lastError = err;
        if (attempt >= retries) throw err;
        var networkWait = backoff[Math.min(attempt, backoff.length - 1)] || 1200;
        await sleep(networkWait);
      }
    }
    if (lastError) throw lastError;
    throw new Error('fetch_failed');
  }

  function loadScriptOnce(src, policy) {
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    var promise = (async function () {
      var retries = policy && Number.isFinite(policy.retries) ? policy.retries : 3;
      var timeoutMs = policy && Number.isFinite(policy.timeoutMs) ? policy.timeoutMs : 9000;
      var backoff = policy && Array.isArray(policy.backoffMs) ? policy.backoffMs : [350, 900, 1800];
      for (var attempt = 0; attempt <= retries; attempt += 1) {
        try {
          await new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var settled = false;
            var timer = setTimeout(function () {
              if (settled) return;
              settled = true;
              reject(new Error('script_timeout'));
            }, timeoutMs);
            script.src = src;
            script.async = false;
            script.onload = function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve();
            };
            script.onerror = function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(new Error('script_error'));
            };
            document.body.appendChild(script);
          });
          return true;
        } catch (err) {
          if (attempt >= retries) throw err;
          await sleep(backoff[Math.min(attempt, backoff.length - 1)] || 1200);
        }
      }
      return false;
    })();

    scriptLoads.set(src, promise);
    promise.catch(function () {
      scriptLoads.delete(src);
    });
    return promise;
  }

  function loadCssOnce(href, policy) {
    if (cssLoads.has(href)) return cssLoads.get(href);
    var promise = (async function () {
      var retries = policy && Number.isFinite(policy.retries) ? policy.retries : 3;
      var timeoutMs = policy && Number.isFinite(policy.timeoutMs) ? policy.timeoutMs : 8000;
      var backoff = policy && Array.isArray(policy.backoffMs) ? policy.backoffMs : [250, 700, 1400];
      for (var attempt = 0; attempt <= retries; attempt += 1) {
        try {
          await new Promise(function (resolve, reject) {
            var link = document.createElement('link');
            var settled = false;
            var timer = setTimeout(function () {
              if (settled) return;
              settled = true;
              reject(new Error('css_timeout'));
            }, timeoutMs);
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve();
            };
            link.onerror = function () {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(new Error('css_error'));
            };
            document.head.appendChild(link);
          });
          return true;
        } catch (err) {
          if (attempt >= retries) throw err;
          await sleep(backoff[Math.min(attempt, backoff.length - 1)] || 1200);
        }
      }
      return false;
    })();

    cssLoads.set(href, promise);
    promise.catch(function () {
      cssLoads.delete(href);
    });
    return promise;
  }

  function prefetchAsset(href, kind) {
    var url = String(href || '').trim();
    if (!url || prefetchedAssets.has(url)) return Promise.resolve(false);
    prefetchedAssets.add(url);
    return new Promise(function (resolve) {
      var link = document.createElement('link');
      var settled = false;
      var finish = function (loaded) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(loaded);
      };
      var timer = setTimeout(function () { finish(false); }, 12000);
      link.rel = 'prefetch';
      link.href = url;
      link.as = kind === 'style' ? 'style' : 'script';
      link.onload = function () { finish(true); };
      link.onerror = function () { finish(false); };
      document.head.appendChild(link);
    });
  }

  async function fetchShellMarkup(url) {
    var res = await supervisorFetch(url, { cache: 'default' }, { retries: 4 });
    if (!res.ok) throw new Error('shell');
    return res.text();
  }

  async function fetchWebMetaVersion() {
    var res = await supervisorFetch('/api/web/meta', { cache: 'no-store' }, { retries: 4 });
    if (!res.ok) throw new Error('meta');
    var data = await res.json();
    if (!data || data.ok !== true) throw new Error('meta');
    ingestSecurityMeta(data);
    window.__FLOW_WEB_META__ = data;
    var version = '';
    if (typeof data.web_asset_version === 'string') {
      version = data.web_asset_version.trim();
    }
    return version;
  }

  async function loadPageModule(name) {
    var assets = {
      network: { script: '/webinterface/network.js', style: '/webinterface/network.css' },
      history: { script: '/webinterface/history.js' }
    };
    var page = assets[name];
    if (!page) throw new Error('unknown_page_module');
    var version = window.__FLOW_WEB_ASSET_VERSION__ || '';
    var jobs = [loadScriptOnce(assetUrl(page.script, version), { retries: 3 })];
    if (page.style) jobs.push(loadCssOnce(assetUrl(page.style, version), { retries: 3 }));
    await Promise.all(jobs);
    var module = window.FlowWebPages && window.FlowWebPages[name];
    if (!module || typeof module.create !== 'function') throw new Error('page_module_init');
    return module;
  }

  async function bootstrap() {
    var root = document.getElementById('app-root');
    if (!root) return;
    applyStoredTheme();

    try {
      var version = '';
      try {
        version = await fetchWebMetaVersion();
      } catch (err) {
        version = getStoredVersion();
      }

      window.__FLOW_WEB_ASSET_VERSION__ = version;
      storeVersion(version);

      // Two independent downloads, within the device's two-asset admission limit.
      var initialAssets = await Promise.all([
        loadCssOnce(assetUrl('/webinterface/app-core.css', version), { retries: 3 }),
        fetchShellMarkup(assetUrl('/webinterface/sh.html', version))
      ]);
      root.className = '';
      root.innerHTML = initialAssets[1];
      window.__FLOW_WEB_APP_READY__ = false;
      var appRuntimeError = '';
      var captureAppError = function (event) {
        if (appRuntimeError) return;
        var message = event && event.message ? String(event.message) : 'exception JavaScript';
        var source = event && event.filename ? String(event.filename).split('/').pop() : 'app.js';
        var line = event && event.lineno ? ':' + event.lineno : '';
        var column = event && event.colno ? ':' + event.colno : '';
        appRuntimeError = message + ' @ ' + source + line + column;
      };
      window.addEventListener('error', captureAppError);
      try {
        await loadScriptOnce(assetUrl('/webinterface/app.js', version), { retries: 3 });
      } finally {
        window.removeEventListener('error', captureAppError);
      }
      if (window.__FLOW_WEB_APP_READY__ !== true) {
        throw new Error(appRuntimeError || 'app_init');
      }
    } catch (err) {
      var detail = err && err.message ? String(err.message) : String(err || 'erreur inconnue');
      window.__FLOW_WEB_BOOT_ERROR__ = detail;
      try { console.error('[flow-web] bootstrap failed:', err); } catch (consoleErr) {}
      setBootStatus("Chargement de l'interface impossible (" + detail + ").", true);
    }
  }

  window.FlowWebCore = {
    sleep: sleep,
    assetUrl: assetUrl,
    parseRetryAfterMs: parseRetryAfterMs,
    csrfToken: function () { return csrfToken; },
    ingestSecurityMeta: ingestSecurityMeta,
    secureFetchOptions: secureFetchOptions,
    csrfAwareMutationFetch: csrfAwareMutationFetch,
    supervisorFetch: supervisorFetch,
    loadScriptOnce: loadScriptOnce,
    loadCssOnce: loadCssOnce,
    loadPageModule: loadPageModule,
    prefetchAsset: prefetchAsset,
    bootstrap: bootstrap,
    applyStoredTheme: applyStoredTheme,
    setBootStatus: setBootStatus
  };
  void bootstrap();
})();
