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
const definitions = app.slice(app.indexOf('    const poolPressureFieldVisibility ='),
  app.indexOf('    const upgradeReconnectFetchTimeoutMs ='));
const functions = ['poolConfigEnsureDocs', 'poolConfigFetchModules',
  'poolConfigRenderAssignmentsStatus', 'poolConfigRender', 'loadPoolConfig'].map(extract).join('\n');

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? {executablePath: process.env.FLOWIO_TEST_BROWSER} : {})});
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="grid"></main>');
    await page.evaluate(({definitions, functions}) => {
      window.poolConfigGrid = document.querySelector('#grid');
      window.poolConfigReqSeq = 0; window.poolConfigLoadedOnce = false;
      window.poolConfigModulesCache = null;
      window.tr = (key, fallback) => fallback;
      window.invalidatePoolDashboardSlots = () => {};
      window.poolConfigRenderSkeleton = () => poolConfigGrid.replaceChildren();
      window.poolConfigRenderError = error => { window.primaryError = String(error); };
      window.poolConfigRenderHero = () => {};
      window.poolConfigRenderDisinfection = () => {};
      window.poolConfigRenderGeneralCards = modules => {
        window.primaryRenderCount++;
        const card = document.createElement('article'); card.id = 'primary';
        const input = document.createElement('input'); input.id = 'draft';
        input.value = String(modules['poollogic/regulation'].dly_pid_min);
        card.append(input); poolConfigGrid.replaceChildren(card);
      };
      window.poolConfigRenderAssignments = modules => {
        assertReady(modules);
        window.assignmentsRenderCount++;
        const form = document.createElement('form'); form.id = 'assignments';
        const output = document.createElement('input'); output.value = modules['io/output/d00'].binding_port;
        form.append(output); poolConfigGrid.append(form);
      };
      window.assertReady = modules => {
        if (!modules['io/input/a15'] || !modules['io/output/d07']) throw new Error('Incomplete assignments');
      };
      window.fetchPoolAlarmSlots = async () => [];
      eval(definitions + functions + `
        const primaryNames = new Set(poolConfigModuleDefs.concat(poolDisinfectionModeDefs).map(def => def.module).concat('poollogic/sensors', 'poollogic/pool'));
        window.reset = () => {
          poolConfigReqSeq = 0; poolConfigLoadedOnce = false; poolConfigModulesCache = null;
          primaryError = ''; primaryRenderCount = 0; assignmentsRenderCount = 0;
          reads = []; activeReads = 0; peakReads = 0; activeDocs = 0; peakDocs = 0;
          assignmentGateOpen = false; pendingAssignments = []; failure = '';
          poolConfigGrid.replaceChildren();
        };
        window.ensureCfgDocsForModule = async () => {
          activeDocs++; peakDocs = Math.max(peakDocs, activeDocs);
          await new Promise(resolve => setTimeout(resolve, 5)); activeDocs--;
        };
        window.poolConfigFetchModule = async name => {
          reads.push(name); activeReads++; peakReads = Math.max(peakReads, activeReads);
          try {
            if (!primaryNames.has(name) && !assignmentGateOpen) {
              await new Promise(resolve => pendingAssignments.push(resolve));
            }
            await new Promise(resolve => setTimeout(resolve, 5));
            if (name === failure) throw new Error('Simulated read failure');
            return {module: name, data: name === 'poollogic/regulation'
              ? {enabled: true, dly_pid_min: 6} : {binding_port: 300}};
          } finally { activeReads--; }
        };
        window.load = loadPoolConfig;
        window.fetchModules = poolConfigFetchModules;
        window.releaseAssignments = () => { assignmentGateOpen = true; pendingAssignments.splice(0).forEach(resolve => resolve()); };
        reset(); window.loading = load(false);
      `);
    }, {definitions, functions});
    await page.waitForFunction(() => primaryRenderCount === 1 && pendingAssignments.length === 3);
    assert.equal(await page.locator('#assignments').count(), 0, 'Incomplete assignments must not become editable');
    assert.equal(await page.locator('[data-pool-assignments-status]').getAttribute('aria-busy'), 'true');
    assert.equal(await page.evaluate(() => reads.slice(0, 12).every(name => name.startsWith('poollogic/'))), true);
    assert.equal(await page.evaluate(() => reads.length), 15, 'Twelve main modules are followed by the first three deferred reads');
    await page.locator('#draft').fill('8');
    await page.evaluate(() => {
      window.originalInput = document.querySelector('#draft');
      poolConfigModulesCache['poollogic/regulation'].dly_pid_min = 7;
      releaseAssignments();
    });
    await page.evaluate(() => loading);
    assert.equal(await page.evaluate(() => document.querySelector('#draft') === originalInput), true);
    assert.equal(await page.locator('#draft').inputValue(), '8', 'Late assignments preserve drafts');
    assert.equal(await page.evaluate(() => poolConfigModulesCache['poollogic/regulation'].dly_pid_min), 7, 'Late assignments preserve acknowledged edits');
    assert.equal(await page.evaluate(() => primaryRenderCount), 1);
    assert.equal(await page.evaluate(() => assignmentsRenderCount), 1);
    assert.equal(await page.locator('#assignments input').inputValue(), '300');
    assert.equal(await page.locator('[data-pool-assignments-status]').count(), 0);
    assert.equal(await page.evaluate(() => reads.length), 43);
    assert.equal(await page.evaluate(() => new Set(reads).size), 43);
    assert.equal(await page.evaluate(() => peakReads), 3);
    assert.equal(await page.evaluate(() => peakDocs), 2);
    await page.evaluate(() => { reset(); failure = 'io/input/a00'; loading = load(false); });
    await page.waitForFunction(() => primaryRenderCount === 1);
    await page.evaluate(() => { releaseAssignments(); });
    await page.evaluate(() => loading);
    assert.equal(await page.locator('#draft').count(), 1, 'An assignment failure does not hide the main cards');
    assert.equal(await page.locator('#assignments').count(), 0);
    assert.equal(await page.locator('[data-pool-assignments-status]').getAttribute('aria-busy'), 'false');
    assert.match(await page.locator('[data-pool-assignments-status]').textContent(), /Simulated read failure/);
    await page.evaluate(() => {
      reset(); const oldSeq = ++poolConfigReqSeq;
      window.stale = fetchModules(Array.from({length: 12}, (_, i) => 'io/input/a' + i), oldSeq);
      ++poolConfigReqSeq; releaseAssignments();
    });
    assert.equal(await page.evaluate(() => stale), null, 'A superseded load cannot publish old data');
    assert.equal(await page.evaluate(() => reads.length), 3, 'A superseded load stops before its next batch');
    console.log('Dashboard loading: early main cards, complete assignments, concurrency limits, preserved drafts/edits, isolated failures and superseded loads passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
