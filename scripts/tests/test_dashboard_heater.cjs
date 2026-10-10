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
  'buildConfigFieldLabel', 'buildConfigFieldApplyButton',
  'poolConfigEditorData', 'poolConfigFieldVisible', 'poolConfigUpdateAssignmentControls', 'poolConfigUpdateEditorLists',
  'poolConfigApplyPatch', 'poolConfigEditorDisplayValue', 'poolConfigEditorStoredValue',
  'poolConfigUpdateFieldEditors', 'poolConfigBuildFieldList',
  'refreshPoolOverview'].map(extract).join('\n');
const definitions = app.slice(app.indexOf('    const poolPressureFieldVisibility ='),
  app.indexOf('    const poolDisinfectionModeDefs ='));
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const docs = json('src/Modules/PoolLogicModule/text/cfgdocs.fr.json').docs;
const enumSets = json('src/Modules/PoolLogicModule/text/cfgmods.fr.json').meta.enum_sets;
const translations = { ...json('data/webinterface/i18n/fr.json').translations,
  ...json('src/Modules/PoolLogicModule/text/i18n.fr.json').translations };

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? { executablePath: process.env.FLOWIO_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="grid"></main>');
    await page.addStyleTag({ path: path.join(root, 'data/webinterface/app-core.css') });
    await page.evaluate(({ functions, definitions, docs, translations, enumSets }) => {
      window.module = 'poollogic/heater';
      window.store = { heater_auto_mode: false, heater_setpoint: 25 };
      window.stores = { [module]: store };
      window.poolConfigModulesCache = { [module]: { ...store } };
      window.poolConfigGrid = document.querySelector('#grid');
      window.poolConfigEditRevision = 0;
      window.flowCfgCurrentModule = module;
      window.flowCfgCurrentData = { ...store };
      window.flowCfgChildrenCache = {};
      window.patches = []; window.admin = true; window.fail = false;
      window.webUiLocale = 'fr';
      window.fieldApplyCheckIcon = '✓';
      window.isAdminSession = () => admin;
      window.canEditPoolSettings = () => admin;
      window.toBool = value => value === true || value === 1 || value === 'true';
      window.tr = (key, fallback) => translations[key] || fallback;
      window.configDocFor = (module, key) => {
        const doc = docs[module + '/' + key];
        return doc ? { ...doc, label: translations[doc.label_t], help: translations[doc.help_t],
          _enumOptions: enumSets[doc.enum_set]?.map(option => ({value: option.value, label: translations[option.label_t]})) } : null;
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
        data: { ...stores[name] } });
      window.fetchJsonResponse = async (url, options) => {
        if (url !== '/api/pool/settings') throw new Error(url);
        const patch = JSON.parse(options.patch);
        patches.push(patch);
        if (window.waitForSave) await new Promise(resolve => { window.finishSave = resolve; });
        if (!fail) Object.entries(patch).forEach(([name, values]) => Object.assign(stores[name] || (stores[name] = {}), values));
        return { res: { ok: !fail }, data: { ok: !fail } };
      };
      eval(definitions + functions + `
      window.build = () => {
        const def = poolConfigModuleDefs.find(def => def.module === module);
        poolConfigGrid.replaceChildren(poolConfigBuildFieldList(module, { ...store }, def));
      };
      window.overview = refreshPoolOverview;
      window.buildModule = name => {
        const def = poolConfigModuleDefs.find(def => def.module === name);
        poolConfigGrid.appendChild(poolConfigBuildFieldList(name, stores[name], def));
      };
      build();`);
    }, { functions, definitions, docs, translations, enumSets });
    async function confirmField(input) {
      const before = await page.evaluate(() => patches.length);
      await input.press('Tab');
      assert.equal(await page.evaluate(() => patches.length), before, 'A change or blur cannot send an unconfirmed value');
      await input.locator('..').getByRole('button', { name: 'Appliquer ce changement', exact: true }).click();
    }
    const activation = page.getByLabel('Mode auto chauffage');
    const setpoint = page.getByLabel('Consigne chauffage (C)');
    assert.equal(await activation.inputValue(), 'false');
    assert.equal(await setpoint.isDisabled(), true);
    await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 0);
    await page.evaluate(() => { window.waitForSave = true; });
    await activation.selectOption('true'); await confirmField(activation);
    await page.waitForFunction(() => !!window.finishSave);
    assert.equal(await activation.isDisabled(), true);
    assert.equal(await setpoint.isDisabled(), true);
    await page.evaluate(() => { window.waitForSave = false; finishSave(); });
    await page.waitForFunction(() => configuration?.heater_auto_mode === true);
    assert.equal(await setpoint.isEnabled(), true);
    assert.deepEqual(await page.evaluate(() => patches[0]), { 'poollogic/heater': { heater_auto_mode: true } });
    await setpoint.fill('26.5'); await setpoint.dispatchEvent('change'); await confirmField(setpoint);
    await page.waitForFunction(() => configuration?.heater_setpoint === 26.5);
    assert.deepEqual(await page.evaluate(() => patches[1]), { 'poollogic/heater': { heater_setpoint: 26.5 } });
    await setpoint.fill('26.3'); await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 2, 'Invalid half-degree step must not be saved');
    await setpoint.fill(''); await setpoint.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), 2, 'Empty setpoint must not become zero');
    await page.evaluate(() => { window.fail = true; });
    await setpoint.fill('27'); await setpoint.dispatchEvent('change'); await confirmField(setpoint);
    await page.waitForFunction(() => document.querySelector('[role=status]').textContent === 'Enregistrement refusé');
    assert.equal(await setpoint.inputValue(), '26.5');
    assert.equal(await page.evaluate(() => configuration.heater_setpoint), 26.5);
    await page.evaluate(() => { window.fail = false; });
    await activation.selectOption('false'); await confirmField(activation);
    await page.waitForFunction(() => configuration.heater_auto_mode === false);
    assert.equal(await setpoint.isDisabled(), true);
    await page.evaluate(() => build());
    assert.equal(await activation.inputValue(), 'false', 'Reload reads the persisted setting');
    assert.equal(await setpoint.inputValue(), '26.5');
    await page.evaluate(async () => { store.heater_auto_mode = true; store.heater_setpoint = 28; await overview(false); });
    assert.equal(await activation.inputValue(), 'true', 'Configuration changes refresh the dashboard');
    assert.equal(await setpoint.inputValue(), '28');
    await setpoint.fill('29');
    await setpoint.press('Tab');
    await page.evaluate(async () => { store.heater_setpoint = 28.5; await overview(false); });
    assert.equal(await setpoint.inputValue(), '29', 'Polling preserves an unconfirmed edit after blur');
    await page.evaluate(() => {
      window.originalFetch = poolConfigFetchModule;
      window.poolConfigFetchModule = name => name === module
        ? new Promise(resolve => { window.finishOldRead = () => resolve({ module: name, data: { ...store } }); })
        : originalFetch(name);
      window.oldRead = overview(false);
    });
    await activation.selectOption('false'); await confirmField(activation);
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
    await page.evaluate(() => {
      admin = true;
      stores['poollogic/modes'] = { robot_auto_mode: false };
      stores['poollogic/robot'] = { robot_delay_min: 30, robot_dur_min: 45 };
      stores['poollogic/safety'] = { flow_start_dly_s: 60, psi_start_dly_s: 60, psi_high_th: 1.8,
        psi_low_th: 0.15, winter_start_t: -2, freeze_hold_t: 2, sensor_hold_wat: true };
      stores['poollogic/sensors'] = { psi_monitoring: true, psi_io_id: 65535,
        flow_switch_enabled: true, flow_switch_io_id: 65535 };
      Object.entries(stores).forEach(([name, values]) => { poolConfigModulesCache[name] = { ...values }; });
      poolConfigGrid.replaceChildren(); buildModule('poollogic/robot'); buildModule('poollogic/safety');
      flowCfgCurrentModule = 'poollogic/modes'; flowCfgCurrentData = { ...stores[flowCfgCurrentModule] };
    });
    const robotAuto = page.getByLabel('Cycle automatique robot');
    const robotDelay = page.getByLabel('Délai robot (min)');
    assert.equal(await robotAuto.inputValue(), 'false');
    assert.equal(await robotDelay.isDisabled(), true);
    await robotAuto.selectOption('true'); await confirmField(robotAuto);
    await page.waitForFunction(() => configuration.robot_auto_mode === true);
    assert.deepEqual(await page.evaluate(() => patches.at(-1)), { 'poollogic/modes': { robot_auto_mode: true } });
    assert.equal(await page.evaluate(() => 'robot_auto_mode' in stores['poollogic/robot']), false, 'Robot uses the existing modes key');
    assert.equal(await robotDelay.isEnabled(), true);
    await robotDelay.fill('12'); await robotDelay.dispatchEvent('change'); await confirmField(robotDelay);
    await page.waitForFunction(() => stores['poollogic/robot'].robot_delay_min === 12);
    let before = await page.evaluate(() => patches.length);
    await robotDelay.fill('256'); await robotDelay.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), before, 'UInt8 overflow is rejected');
    await robotDelay.fill('12');
    const flowDelay = page.getByLabel('Délai avant contrôle du débit (s)');
    const pressureDelay = page.getByLabel('Délai avant contrôle de pression (s)');
    const pressureMax = page.getByLabel('Seuil pression haute');
    assert.equal(await flowDelay.isHidden(), true);
    assert.equal(await pressureDelay.isHidden(), true);
    assert.equal(await pressureMax.isHidden(), true);
    before = await page.evaluate(() => patches.length);
    await pressureMax.dispatchEvent('change');
    assert.equal(await page.evaluate(() => patches.length), before, 'Hidden fields cannot submit changes');
    await page.evaluate(async () => {
      stores['poollogic/sensors'].flow_switch_io_id = 69;
      stores['poollogic/sensors'].psi_io_id = 194;
      await overview(false);
    });
    assert.equal(await flowDelay.isVisible(), true, 'Configured flow remains visible without a live reading');
    assert.equal(await pressureMax.isVisible(), true);
    const safety = page.locator('.pool-field-editor-list[data-module="poollogic/safety"]');
    assert.deepEqual(await safety.locator('.control-label').allTextContents(), [
      'Délai avant contrôle du débit (s)', 'Délai avant contrôle de pression (s)',
      'Seuil pression haute', 'Seuil pression basse', 'Seuil entrée hiver (C)',
      'Seuil maintien hors gel (C)', 'Sonde température d’eau']);
    await page.evaluate(() => {
      flowCfgCurrentModule = 'poollogic/safety'; flowCfgCurrentData = { ...stores[flowCfgCurrentModule] };
    });
    await pressureMax.fill('2.05'); await pressureMax.dispatchEvent('change'); await confirmField(pressureMax);
    await page.waitForFunction(() => configuration.psi_high_th === 2.05);
    assert.equal(await page.evaluate(() => stores['poollogic/safety'].psi_high_th), 2.05);
    await page.evaluate(() => {
      const form = document.createElement('form'); form.className = 'pool-assignment-form';
      const input = document.createElement('select'); input.id = 'testLocation';
      input.dataset.configModule = 'poollogic/safety'; input.dataset.configKey = 'sensor_hold_wat';
      input.innerHTML = '<option value="1">Tuyauterie</option><option value="0">Bassin</option>';
      input.value = '1'; input.dataset.initialValue = '1'; form.appendChild(input); poolConfigGrid.appendChild(form);
    });
    const location = page.getByLabel('Sonde température d’eau');
    assert.deepEqual(await location.locator('option').allTextContents(), ['Tuyauterie', 'Bassin']);
    await location.selectOption('false'); await confirmField(location);
    await page.waitForFunction(() => configuration.sensor_hold_wat === false);
    assert.equal(await page.locator('#testLocation').inputValue(), '0', 'Probe assignment follows the dashboard edit');
    await page.evaluate(async () => {
      stores['poollogic/robot'].robot_dur_min = 35;
      stores['poollogic/sensors'].psi_monitoring = false;
      stores['poollogic/sensors'].flow_switch_enabled = false;
      await overview(false);
    });
    assert.equal(await page.getByLabel('Durée robot (min)').inputValue(), '35', 'Robot follows configuration polling');
    assert.equal(await pressureDelay.isHidden(), true);
    assert.equal(await flowDelay.isHidden(), true);
    await page.evaluate(() => {
      stores['poollogic/regulation'] = { enabled: true, dly_pid_min: 5, pid_min_on_ms: 30000, pid_sample_ms: 30000 };
      poolConfigModulesCache['poollogic/regulation'] = { ...stores['poollogic/regulation'] };
      flowCfgCurrentModule = 'poollogic/regulation'; flowCfgCurrentData = { ...stores[flowCfgCurrentModule] };
      buildModule('poollogic/regulation');
    });
    const regulation = page.locator('.pool-field-editor-list[data-module="poollogic/regulation"]');
    assert.deepEqual(await regulation.locator('.control-label').allTextContents(), [
      'Régulation automatique', 'Délai après démarrage filtration (min)',
      'Durée minimale d’injection (s)', 'Intervalle de calcul de la régulation (s)']);
    const dosingEnabled = page.getByLabel('Régulation automatique', { exact: true });
    const dosingDelay = page.getByLabel('Délai après démarrage filtration (min)', { exact: true });
    const minimumDose = page.getByLabel('Durée minimale d’injection (s)', { exact: true });
    const sampling = page.getByLabel('Intervalle de calcul de la régulation (s)', { exact: true });
    assert.equal(await minimumDose.inputValue(), '30');
    assert.equal(await sampling.inputValue(), '30');
    assert.deepEqual(await dosingEnabled.locator('option').allTextContents(), ['Actif', 'Inactif']);
    await dosingEnabled.selectOption('false'); await confirmField(dosingEnabled);
    await page.waitForFunction(() => configuration.enabled === false);
    assert.deepEqual(await page.evaluate(() => patches.at(-1)), { 'poollogic/regulation': { enabled: false } });
    assert.equal(await dosingDelay.isDisabled(), true); assert.equal(await minimumDose.isDisabled(), true);
    assert.equal(await sampling.isDisabled(), true);
    await dosingEnabled.selectOption('true'); await confirmField(dosingEnabled);
    await page.waitForFunction(() => configuration.enabled === true);
    assert.equal(await sampling.isEnabled(), true);
    before = await page.evaluate(() => patches.length);
    await sampling.fill('0.099'); await sampling.dispatchEvent('change');
    assert(await sampling.locator('..').locator('button').isDisabled());
    assert.equal(await page.evaluate(() => patches.length), before, 'Sampling cannot be shorter than the firmware minimum');
    await sampling.fill('2147483.648'); await sampling.dispatchEvent('change');
    assert(await sampling.locator('..').locator('button').isDisabled());
    assert.equal(await page.evaluate(() => patches.length), before, 'Int32 overflow cannot be saved');
    await sampling.fill('15'); await sampling.dispatchEvent('change'); await confirmField(sampling);
    await page.waitForFunction(() => configuration.pid_sample_ms === 15000);
    assert.equal(await page.evaluate(() => stores['poollogic/regulation'].pid_sample_ms), 15000);
    await minimumDose.fill('1'); await minimumDose.dispatchEvent('change'); await confirmField(minimumDose);
    await page.waitForFunction(() => configuration.pid_min_on_ms === 1000);
    await page.evaluate(async () => { stores['poollogic/regulation'].pid_sample_ms = 1234; await overview(false); });
    assert.equal(await sampling.inputValue(), '1.234', 'Refresh converts the canonical milliseconds without rounding away saved values');
    before = await page.evaluate(() => patches.length);
    await sampling.fill('2'); await sampling.blur();
    await page.evaluate(async () => { await overview(false); });
    assert.equal(await sampling.inputValue(), '2', 'Refresh preserves a draft in seconds');
    assert.equal(await page.evaluate(() => patches.length), before, 'A seconds draft still requires explicit validation');
    await page.evaluate(() => { fail = true; });
    await confirmField(sampling);
    await page.waitForFunction(() => document.querySelector('[data-key="pid_sample_ms"]').value === '1.234');
    await page.evaluate(() => { fail = false; });
    await sampling.fill('0.1'); await confirmField(sampling);
    await page.waitForFunction(() => configuration.pid_sample_ms === 100);
    await dosingDelay.fill('6'); await dosingDelay.dispatchEvent('change'); await confirmField(dosingDelay);
    await page.waitForFunction(() => configuration.dly_pid_min === 6);
    await page.evaluate(async () => { stores['poollogic/regulation'].enabled = false; await overview(false); });
    assert.equal(await dosingEnabled.inputValue(), 'false'); assert.equal(await dosingDelay.isDisabled(), true);
    console.log('Regulation: persistent activation, shared timers, bounds, labels and inactive controls passed.');
    console.log('Dashboard heater: persistent shared settings, explicit validation, inactive controls, rollback and refresh races passed.');
    console.log('Robot and protections: canonical modes key, editable values, sensor visibility, order, bounds and assignment synchronization passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
