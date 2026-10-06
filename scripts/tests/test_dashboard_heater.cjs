'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'data/webinterface/app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const end = app.slice(start + 1).search(/^    (?:async )?function /m);
  assert(end >= 0, name);
  return app.slice(start, start + 1 + end);
}
const functions = ['poolConfigDoc', 'poolConfigFieldLabel', 'poolConfigEnumLabel',
  'poolConfigFormatValue', 'poolConfigFormatNumber', 'poolConfigFormatDurationMs',
  'poolConfigFormatHour', 'poolConfigBoolLabel', 'poolConfigFields',
  'poolConfigApplyPatch', 'poolConfigUpdateFieldEditors', 'poolConfigBuildFieldList',
  'refreshPoolOverview'].map(extract).join('\n');
const definitions = app.slice(app.indexOf('    const poolConfigModuleDefs ='),
  app.indexOf('    const poolDisinfectionModeDefs ='));
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const docs = json('src/Modules/PoolLogicModule/text/cfgdocs.fr.json').docs;
const translations = { ...json('data/webinterface/i18n/fr.json').translations,
  ...json('src/Modules/PoolLogicModule/text/i18n.fr.json').translations };

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? { executablePath: process.env.FLOWIO_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="grid"></main>');
    await page.addStyleTag({ path: path.join(root, 'data/webinterface/app-core.css') });
    await page.evaluate(({ functions, definitions, docs, translations }) => {
      window.module = 'poollogic/heater';
      window.store = { heater_auto_mode: false, heater_setpoint: 25 };
      window.poolConfigModulesCache = { [module]: { ...store } };
      window.poolConfigGrid = document.querySelector('#grid');
      window.poolConfigEditRevision = 0;
      window.flowCfgCurrentModule = module;
      window.flowCfgCurrentData = { ...store };
      window.flowCfgChildrenCache = {};
      window.patches = []; window.admin = true; window.fail = false;
      window.webUiLocale = 'fr';
      window.isAdminSession = () => admin;
      window.toBool = value => value === true || value === 1 || value === 'true';
      window.tr = (key, fallback) => translations[key] || fallback;
      window.configDocFor = (module, key) => {
        const doc = docs[module + '/' + key];
        return doc ? { ...doc, label: translations[doc.label_t] } : null;
      };
      window.renderFlowCfgFieldsWithExtensions = data => { window.configuration = { ...data }; };
      window.invalidatePoolDashboardSlots = () => {};
      window.createFormPostOptions = options => options;
      window.fetchWithBusyRetry = () => {};
      window.formatFlowCfgApplyError = () => 'Enregistrement refusé';
      window.refreshPoolMeasures = async () => {};
      window.poolConfigRenderHero = () => {};
      window.fetchPoolAlarmSlots = async () => [];
      window.poolConfigFetchModule = async name => ({ module: name,
        data: name === module ? { ...store } : {} });
      window.fetchJsonResponse = async (url, options) => {
        if (url !== '/api/flowcfg/apply') throw new Error(url);
        const patch = JSON.parse(options.patch);
        patches.push(patch);
        if (window.waitForSave) await new Promise(resolve => { window.finishSave = resolve; });
        if (!fail) Object.assign(store, patch[module]);
        return { res: { ok: !fail }, data: { ok: !fail } };
      };
      eval(definitions + functions + `
      window.build = () => {
        const def = poolConfigModuleDefs.find(def => def.module === module);
        poolConfigGrid.replaceChildren(poolConfigBuildFieldList(module, { ...store }, def));
      };
      window.overview = refreshPoolOverview;
      build();`);
    }, { functions, definitions, docs, translations });
    const activation = page.getByLabel('Mode auto chauffage');
    const setpoint = page.getByLabel('Consigne chauffage (C)');
    assert.equal(await activation.inputValue(), 'false');
    assert.equal(await setpoint.isDisabled(), true);
    await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 0);
    await page.evaluate(() => { window.waitForSave = true; });
    await activation.selectOption('true');
    await page.waitForFunction(() => !!window.finishSave);
    assert.equal(await activation.isDisabled(), true);
    assert.equal(await setpoint.isDisabled(), true);
    await page.evaluate(() => { window.waitForSave = false; finishSave(); });
    await page.waitForFunction(() => configuration?.heater_auto_mode === true);
    assert.equal(await setpoint.isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => patches[0]), { 'poollogic/heater': { heater_auto_mode: true } });
    await setpoint.fill('26.5'); await setpoint.dispatchEvent('change');
    await page.waitForFunction(() => configuration?.heater_setpoint === 26.5);
    assert.deepEqual(await page.evaluate(() => patches[1]), { 'poollogic/heater': { heater_setpoint: 26.5 } });
    await setpoint.fill('26.3'); await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 2, 'Invalid half-degree step must not be saved');
    await setpoint.fill(''); await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 2, 'Empty setpoint must not become zero');
    await page.evaluate(() => { window.fail = true; });
    await setpoint.fill('27'); await setpoint.dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent === 'Enregistrement refusé');
    assert.equal(await setpoint.inputValue(), '26.5');
    assert.equal(await page.evaluate(() => configuration.heater_setpoint), 26.5);
    await page.evaluate(() => { window.fail = false; });
    await activation.selectOption('false');
    await page.waitForFunction(() => configuration.heater_auto_mode === false);
    assert.equal(await setpoint.isDisabled(), true);
    await page.evaluate(() => build());
    assert.equal(await activation.inputValue(), 'false', 'Reload reads the persisted setting');
    assert.equal(await setpoint.inputValue(), '26.5');
    await page.evaluate(async () => { store.heater_auto_mode = true; store.heater_setpoint = 28; await overview(false); });
    assert.equal(await activation.inputValue(), 'true', 'Configuration changes refresh the dashboard');
    assert.equal(await setpoint.inputValue(), '28');
    await setpoint.fill('29');
    await page.evaluate(async () => { store.heater_setpoint = 28.5; await overview(false); });
    assert.equal(await setpoint.inputValue(), '29', 'Polling preserves a focused edit');
    await page.evaluate(() => {
      window.originalFetch = poolConfigFetchModule;
      window.poolConfigFetchModule = name => name === module
        ? new Promise(resolve => { window.finishOldRead = () => resolve({ module: name, data: { ...store } }); })
        : originalFetch(name);
      window.oldRead = overview(false);
    });
    await activation.selectOption('false');
    await page.waitForFunction(() => configuration.heater_auto_mode === false);
    await page.evaluate(async () => {
      store.heater_auto_mode = true; finishOldRead(); await oldRead;
      poolConfigFetchModule = originalFetch;
    });
    assert.equal(await activation.inputValue(), 'false', 'An older read cannot undo a newer save');
    await page.evaluate(() => { window.admin = false; build(); });
    assert.equal(await activation.isDisabled(), true);
    assert.equal(await setpoint.isDisabled(), true);
    const count = await page.evaluate(() => patches.length);
    await activation.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), count, 'Viewers cannot write settings');
    console.log('Dashboard heater: persistent shared settings, validation, inactive controls, rollback and refresh races passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
