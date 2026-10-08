'use strict';
// Use a real HTTP server: Playwright request interception disables the browser cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'data/webinterface/app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'data/webinterface/app-core.js'), 'utf8');
function extract(source, name, indent = '    ') {
  const start = source.search(new RegExp('^' + indent + '(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const end = source.slice(start + 1).search(new RegExp('^' + indent + '(?:async )?function ', 'm'));
  assert(end >= 0, name);
  return source.slice(start, start + 1 + end);
}
const functions = ['assetUrl', 'webI18nAssetUrlForLocale', 'ensureWebUiLocaleBundle',
  'cfgDocLocaleAssetUrl', 'loadCfgDocI18nBundle', 'loadCfgDocIndex', 'getCfgDocForModule',
  'fetchFlowCfgModules'].map(name => extract(app, name)).join('\n') + extract(core, 'fetchShellMarkup', '  ');
const requests = [];
let version = 'one';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname);
  if (url.pathname === '/') {
    res.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'});
    return res.end('<!doctype html><title>Cache regression</title>');
  }
  const isStatic = url.pathname.startsWith('/api/cfgdoc/') || url.pathname.startsWith('/webinterface/');
  res.writeHead(200, {'Content-Type': 'application/json',
    'Cache-Control': isStatic && url.searchParams.get('v') === version
      ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate'});
  if (url.pathname === '/api/web/meta') return res.end(JSON.stringify({web_asset_version: version}));
  if (url.pathname === '/api/cfgdoc/index') return res.end(JSON.stringify({modules: {example: 'example.j'}}));
  if (url.pathname === '/api/cfgdoc/module') return res.end(JSON.stringify({docs: {field: {help: version}}}));
  if (url.pathname === '/api/flowcfg/batch') {
    return res.end(JSON.stringify({ok: true, modules: Object.fromEntries(
      JSON.parse(url.searchParams.get('names')).map(name => [name, {value: version}]))}));
  }
  return res.end(JSON.stringify({translations: {label: version}}));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? {executablePath: process.env.FLOWIO_TEST_BROWSER} : {})});
  try {
    const page = await browser.newPage();
    const base = 'http://127.0.0.1:' + server.address().port;
    async function load() {
      await page.goto(base);
      return page.evaluate(async functions => {
        const webAssetVersion = (await (await fetch('/api/web/meta', {cache: 'no-store'})).json()).web_asset_version;
        const webUiLocaleBundleState = {loaded: {}, loading: {}};
        const webUiI18n = {};
        let flowCfgDocIndex, flowCfgDocIndexPromise, flowCfgDocIndexUnavailable = false;
        let flowCfgDocI18nLocale, flowCfgDocI18nMap = {}, flowCfgDocI18nPromise;
        const flowCfgDocModuleCache = new Map(), flowCfgDocModuleLoadPromises = new Map(), flowCfgDocBundleLoadPromises = new Map();
        const normalizeWebUiLocale = locale => locale, cfgDocKeyFromModuleName = name => name;
        const normalizeDocSource = source => source, cfgI18nDebugLog = () => {};
        const nettoyerNomFlowCfg = name => name.trim(), tr = (key, fallback) => fallback;
        const supervisorFetch = fetch, fetchWithBusyRetry = fetch;
        const fetchOkJson = async (url, options) => {
          const response = await fetch(url, options);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        };
        eval(functions + `
          window.testLoad = async () => {
            await fetchShellMarkup(assetUrl('/webinterface/sh.html'));
            if (!await ensureWebUiLocaleBundle('fr', false)) throw new Error('UI translations');
            if (!await loadCfgDocI18nBundle('fr', false)) throw new Error('Config translations');
            const docs = await getCfgDocForModule('example');
            const live = await fetchFlowCfgModules(['example']);
            return {ui: webUiI18n.fr.label, help: docs.docs.field.help, live: live.example.value};
          };
          window.forceTranslations = () => Promise.all([
            ensureWebUiLocaleBundle('fr', true), loadCfgDocI18nBundle('fr', true)]);
        `);
        return testLoad();
      }, functions);
    }
    assert.deepEqual(await load(), {ui: 'one', help: 'one', live: 'one'});
    const count = name => requests.filter(path => path === name).length;
    const staticPaths = ['/webinterface/sh.html', '/webinterface/i18n/fr.json',
      '/api/cfgdoc/i18n', '/api/cfgdoc/index', '/api/cfgdoc/module'];
    for (const name of staticPaths) assert.equal(count(name), 1);
    assert.deepEqual(await load(), {ui: 'one', help: 'one', live: 'one'});
    for (const name of staticPaths) assert.equal(count(name), 1, name + ' must survive page reload in browser cache');
    assert.equal(count('/api/flowcfg/batch'), 2, 'Live configuration must be fetched again');
    version = 'two';
    assert.deepEqual(await load(), {ui: 'two', help: 'two', live: 'two'});
    for (const name of staticPaths) assert.equal(count(name), 2, name + ' must update with the new asset version');
    await page.evaluate(() => forceTranslations());
    assert.equal(count('/webinterface/i18n/fr.json'), 3, 'Explicit reload bypasses cached translations');
    assert.equal(count('/api/cfgdoc/i18n'), 3);
    // Reject missing or malformed module data before making a partial dashboard editable.
    await page.evaluate(async functions => {
      const nettoyerNomFlowCfg = name => name.trim(), tr = (key, fallback) => fallback;
      const fetchWithBusyRetry = () => {};
      let payload;
      const fetchOkJson = async () => payload;
      eval(functions + '; window.readBatch = fetchFlowCfgModules;');
      for (payload of [{}, {modules: []}, {modules: {}}, {modules: {example: null}},
        {modules: {example: []}}, {modules: {example: 1}}]) {
        let rejected = false;
        try { await readBatch(['example']); } catch { rejected = true; }
        if (!rejected) throw new Error('Malformed batch was accepted');
      }
    }, extract(app, 'fetchFlowCfgModules'));
    console.log('Versioned cache: reload reuse, update invalidation, forced refresh, fresh live data and incomplete batch rejection passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
