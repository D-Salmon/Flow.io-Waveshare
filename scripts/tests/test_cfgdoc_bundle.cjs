'use strict';
// Real HTTP responses let Chrome exercise versioned caching, including reloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'data/webinterface/app.js'), 'utf8');
const data = file => JSON.parse(fs.readFileSync(path.join(root, 'data/wc', file), 'utf8'));
const index = data('i.j'), group = index.bundles.poollogic;
const payload = data(index.modules[group.module]);
function extract(name) {
  const start = app.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const end = app.slice(start + 1).search(/^    (?:async )?function /m);
  assert(end >= 0, name);
  return app.slice(start, start + 1 + end);
}
const functions = ['assetUrl','normalizeWebUiLocale','cfgDocTr','nettoyerNomFlowCfg','cfgDocKeyFromModuleName',
  'cfgDocLocaleAssetUrl','loadCfgDocI18nBundle','loadCfgDocIndex','getCfgDocForModule',
  'loadCfgDocBundle','poolConfigEnsureDocs','ensureCfgDocsForModule','rebuildCfgDocSources',
  'normalizeDocSource','cfgDocResolveLocalizedText','cfgDocApplyLocalizedText'].map(extract).join('\n');
let version = 'one', broken = false, indexUnavailable = false, gate = null;
const requests = [];
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname + url.search);
  if (url.pathname === '/') {
    res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-store'});
    return res.end('<!doctype html><title>Bundle regression</title>');
  }
  let body;
  if (url.pathname === '/api/cfgdoc/index' && indexUnavailable) {
    res.writeHead(503, {'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({ok:false}));
  }
  if (url.pathname === '/api/cfgdoc/index') body = index;
  if (url.pathname === '/api/cfgdoc/i18n') body = data('i18n.' + url.searchParams.get('locale') + '.j');
  if (url.pathname === '/api/cfgdoc/module') {
    const name = url.searchParams.get('name');
    body = data(index.modules[name]);
    if (name === group.module) {
      if (gate) await gate;
      if (broken) delete body.modules[group.members.at(-1)];
    }
  }
  if (!body) {res.writeHead(404);return res.end();}
  const bytes = zlib.gzipSync(JSON.stringify(body));
  res.writeHead(200, {'Content-Type':'application/json','Content-Encoding':'gzip',
    'Cache-Control':broken ? 'no-store' : 'public, max-age=31536000, immutable'});
  res.end(bytes);
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    async function install() {
      await page.goto(base);
      await page.evaluate(({functions,version}) => {
        const webAssetVersion = version;
        let webUiLocale = 'fr', flowCfgDocIndex = null, flowCfgDocIndexPromise = null;
        let flowCfgDocI18nLocale = '', flowCfgDocI18nMap = {}, flowCfgDocI18nPromise = null, cfgDocSources = [];
        const flowCfgDocModuleCache = new Map(), flowCfgDocModuleLoadPromises = new Map(), flowCfgDocBundleLoadPromises = new Map();
        const cfgDocWildcardModuleKey = '__wildcard', cfgI18nDebugLog = () => {}, chargerCfgTreeMetaDepuisDocs = () => {};
        const fetchOkJson = async (url,options) => {
          const response = await fetch(url,options);
          const body = await response.json();
          if (!response.ok || body.ok !== true) throw new Error('HTTP ' + response.status);
          return body;
        };
        eval(functions + `
          window.loadGroup = poolConfigEnsureDocs;
          window.readModule = ensureCfgDocsForModule;
          window.cache = () => Object.fromEntries(flowCfgDocModuleCache);
          window.pending = () => flowCfgDocBundleLoadPromises.size;
          window.setLocale = locale => {webUiLocale = locale;};
          window.localized = () => Object.fromEntries([...flowCfgDocModuleCache].map(([name,source]) =>
            [name,Object.fromEntries(Object.entries(source.docs).map(([key,doc]) => [key,cfgDocApplyLocalizedText(doc)]))]));
        `);
      }, {functions,version});
    }
    const bundleReads = () => requests.filter(url => url.includes('name=' + group.module)).length;
    await install();
    await page.evaluate(() => Promise.all([loadGroup(),loadGroup(),loadGroup()]));
    assert.equal(bundleReads(),1);
    assert.equal(requests.filter(url => url.startsWith('/api/cfgdoc/module')).length,1);
    const expected = Object.fromEntries(group.members.map(key => {
      const source = data(index.modules[key]); return [key,{docs:source.docs,meta:source.meta}];
    }));
    assert.deepEqual(await page.evaluate(() => cache()),expected,'All cached fields, types, bounds and enum metadata match individual chunks');
    const moduleCalls = requests.filter(url => url.startsWith('/api/cfgdoc/module')).length;
    await page.evaluate(() => readModule('poollogic/heater'));
    assert.equal(requests.filter(url => url.startsWith('/api/cfgdoc/module')).length,moduleCalls);
    for (const locale of ['fr','en']) {
      await page.evaluate(async locale => {setLocale(locale);await loadGroup();},locale);
      const translations = data('i18n.' + locale + '.j').translations;
      const localized = await page.evaluate(() => localized());
      for (const [name,source] of Object.entries(expected)) for (const [key,doc] of Object.entries(source.docs)) {
        const token = doc.label_i18n || doc.label_t;
        if (token && translations[token]) assert.equal(localized[name][key].label,translations[token]);
      }
    }
    const afterFirst = requests.length;
    await install(); await page.evaluate(() => loadGroup());
    assert.equal(bundleReads(),1,'Reload reuses the versioned bundle in HTTP cache');
    assert.equal(requests.length,afterFirst+1,'Only the test document is downloaded after reload');
    version = 'two'; await install(); await page.evaluate(() => loadGroup());
    assert.equal(bundleReads(),2,'A new asset version invalidates the bundle cache');
    version = 'broken'; broken = true; await install();
    const failure = await page.evaluate(() => loadGroup().then(() => null,error => error.message));
    assert.equal(failure,'cfgdoc_bundle_incomplete');
    assert.deepEqual(await page.evaluate(() => cache()),{},'An incomplete bundle cannot populate a partial cache');
    assert.equal(await page.evaluate(() => pending()),0);
    broken = false; await page.evaluate(() => loadGroup());
    assert.deepEqual(await page.evaluate(() => cache()),expected);
    version = 'index-failure'; indexUnavailable = true; await install();
    assert.equal(await page.evaluate(() => loadGroup().then(() => null,error => error.message)),'HTTP 503');
    assert.deepEqual(await page.evaluate(() => cache()),{});
    indexUnavailable = false; await page.evaluate(() => loadGroup());
    assert.deepEqual(await page.evaluate(() => cache()),expected,'A failed index request can be retried in the same page');
    version = 'concurrent'; let release; gate = new Promise(resolve => {release = resolve;});
    await install(); const before = bundleReads();
    await page.evaluate(() => {window.loading = loadGroup();});
    for (let i=0;bundleReads()===before && i<100;i++) await new Promise(resolve => setTimeout(resolve,10));
    assert.equal(bundleReads(),before+1);
    const concurrentCalls = requests.length;
    await page.evaluate(() => {window.branch = readModule('poollogic/heater');});
    release(); await page.evaluate(() => Promise.all([loading,branch]));
    assert.equal(requests.length,concurrentCalls,'A branch opened during bundle reception shares the pending read');
    assert.deepEqual(errors,[]);
    console.log('Cfgdoc bundle: one request, exact individual-field parity, FR/EN, shared pending reads, HTTP reload cache, version invalidation, atomic failure and retry passed.');
  } finally {await browser.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;server.close();});
