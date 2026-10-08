'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const app = fs.readFileSync(path.resolve(__dirname, '../../data/webinterface/app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const end = app.slice(start + 1).search(/^    (?:async )?function /m);
  assert(end >= 0, name);
  return app.slice(start, start + 1 + end);
}
const functions = ['normalizeWebUiLocale', 'tr', 'applyStaticTranslations', 'ensureWebUiLocaleBundle',
  'applyWebUiLocale', 'fetchConfiguredWebUiLocale', 'refreshWebUiLocale'].map(extract).join('\n');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const requests = [], errors = [];
    let configured = 'fr', failEnglish = false, holdEnglish = false, releaseEnglish;
    const englishGate = new Promise(resolve => { releaseEnglish = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://flowio.local/**', async route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:
        '<div data-i18n="test.title">Titre</div><section id="dashboard"><input value="6"></section><section id="configuration"><input value="15"></section>'});
      if (url.pathname === '/api/flowcfg/module') return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:{lang:configured}})});
      const en = url.pathname.endsWith('/en.json');
      if (en && holdEnglish) await englishGate;
      if (en && failEnglish) return route.fulfill({status:503});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({'test.title':en?'Title':'Titre'})});
    });
    await page.goto('http://flowio.local/');
    const installTestRuntime = () => page.evaluate(functions => {
      let webUiLocale = 'fr', webUiRenderedLocale = null;
      let webUiI18n = {fr:{},en:{}};
      const webUiLocaleBundleState = {loaded:{},loading:{}};
      let webUiLocaleProbeInFlight = false, webUiLocaleProbePromise = null, webUiLocaleNextProbeAt = 0;
      const webUiLocaleProbeActiveMs = 5000, webUiLocaleProbeIdleMs = 15000;
      let poolConfigLoadedOnce = true, activePage = 'page-dashboard';
      const getActivePageId = () => activePage;
      const fetchWithBusyRetry = fetch;
      const webI18nAssetUrlForLocale = locale => '/webinterface/i18n/' + locale + '.json';
      const noop = () => {};
      const cfgI18nDebugLog = noop, syncMobileTopbarTitle = noop, updateInfoLoadButtonsText = noop,
        updateThemeToggleUi = noop, currentThemePreference = noop, applyProfileUiText = noop,
        syncMenuIconFallbacks = noop, renderInfoPanel = noop, refreshPoolMeasuresView = noop,
        refreshPoolAiResultTitle = noop;
      window.dashboardReloads = 0; window.configRenders = 0;
      const loadPoolConfig = async () => {
        dashboardReloads++;
        document.querySelector('#dashboard').innerHTML = '<input value="6">';
      };
      const refreshCfgDocLocaleRuntime = async () => {
        configRenders++;
        if (activePage === 'page-control') document.querySelector('#configuration').innerHTML = '<input value="15">';
      };
      eval(functions + `
        window.applyLocale = applyWebUiLocale;
        window.probeLocale = () => refreshWebUiLocale(true);
        window.setActivePage = page => {activePage = page;};
      `);
    }, functions);
    await installTestRuntime();
    await page.evaluate(() => Promise.all(Array.from({length:6}, () => applyLocale('fr'))));
    assert.equal(requests.filter(name => name.endsWith('/fr.json')).length, 1);
    assert.equal(await page.evaluate(() => dashboardReloads), 1, 'Concurrent initial probes render a bundle once');
    await page.locator('#dashboard input').fill('8');
    await page.locator('#dashboard input').focus();
    await page.evaluate(() => {window.originalDraft = document.querySelector('#dashboard input');});
    const renders = await page.evaluate(() => ({dashboardReloads,configRenders}));
    for (let i = 0; i < 5; ++i) await page.evaluate(() => probeLocale());
    await page.evaluate(() => applyLocale('fr'));
    assert.deepEqual(await page.evaluate(() => ({dashboardReloads,configRenders})), renders);
    assert.equal(await page.locator('#dashboard input').inputValue(), '8');
    assert.equal(await page.evaluate(() => originalDraft === document.activeElement), true);
    await page.evaluate(() => setActivePage('page-control'));
    await page.locator('#configuration input').fill('17');
    await page.evaluate(() => probeLocale());
    assert.equal(await page.locator('#configuration input').inputValue(), '17', 'Unchanged locale preserves Configuration drafts too');
    // A failed translation download remains retryable; a successful retry renders it.
    failEnglish = true;
    await page.evaluate(() => applyLocale('en'));
    assert.equal(await page.locator('[data-i18n]').innerText(), 'Titre');
    failEnglish = false;
    await page.evaluate(() => applyLocale('en'));
    assert.equal(await page.locator('[data-i18n]').innerText(), 'Title');
    await page.evaluate(() => applyLocale('fr'));
    assert.equal(await page.locator('[data-i18n]').innerText(), 'Titre');
    // Fresh page exercises a language switch while another bundle is in flight.
    await page.reload();
    await installTestRuntime();
    await page.evaluate(() => applyLocale('fr'));
    holdEnglish = true;
    await page.evaluate(() => {window.pendingEnglish = applyLocale('en');});
    await page.evaluate(() => applyLocale('fr'));
    releaseEnglish();
    await page.evaluate(() => pendingEnglish);
    assert.equal(await page.locator('[data-i18n]').innerText(), 'Titre');
    assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
    assert.deepEqual(errors, []);
    console.log('Locale: one render per bundle, unchanged probes preserve drafts/focus without config reloads, changed language, failed-download retry and stale-language response passed.');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
