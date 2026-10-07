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
const functions = ['stopPoolAiPreviewPolling', 'formatPoolAiInsightTimestamp', 'refreshPoolAiResultTitle',
  'syncPoolAiRefreshButton', 'renderPoolAiInsight', 'renderPoolAiPreview', 'schedulePoolAiStatusPolling',
  'loadPoolAiStatus', 'loadPoolAiPreview', 'requestPoolAiInsight', 'renderConfigFields',
  'buildConfigFieldLabel', 'configNumericKind', 'storeConfigFieldInitialValue', 'readConfigFieldValue',
  'configFieldIsDirty', 'setConfigFieldValidationState', 'validateConfigFieldValue', 'readConfigFieldValueStrict',
  'updatePrimaryCfgApplyState', 'buildPatchJsonFromFields'].map(extract).join('\n');
const docs = JSON.parse(fs.readFileSync(path.join(root, 'data/webinterface/cfgdocs.json'))).docs;

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="poolAiRefresh"></button><h3 id="poolAiResultTitle"></h3><p id="poolAiStatus"></p><pre id="poolAiInsightText"></pre><pre id="poolAiWeatherText"></pre><pre id="poolAiPromptText"></pre><span id="poolAiLastAnalysis"></span><span id="poolAiNextAnalysis"></span><main id="fields"></main><button id="apply">Appliquer</button>');
    await page.evaluate(({functions, docs}) => {
      ['poolAiRefresh','poolAiResultTitle','poolAiStatus','poolAiInsightText','poolAiWeatherText','poolAiPromptText','poolAiLastAnalysis','poolAiNextAnalysis'].forEach(id => window[id] = document.getElementById(id));
      window.poolAiRefreshBtn = poolAiRefresh;
      window.flowCfgFields = document.querySelector('#fields'); window.flowCfgApplyBtn = document.querySelector('#apply');
      window.poolAiPreviewPollTimer = null; window.poolAiPreviewReqSeq = 0;
      window.poolAiPreviewLoadedOnce = false; window.poolAiPreviewWeatherState = 'idle'; window.poolAiReady = false;
      window.calls = []; window.saves = []; window.timers = new Map(); window.timerId = 0; window.pageId = 'page-dashboard';
      window.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, {callback,delay}); return id; };
      window.clearTimeout = id => timers.delete(id);
      window.getActivePageId = () => pageId; window.tr = (key, fallback) => fallback;
      window.runAsyncTaskSafely = callback => callback();
      window.payload = {ok:true,enabled:false,api_key_configured:false,weather_state:'queued',weather_text:'Waiting',
        insight_state:'idle',insight_text:'',schedule:{enabled:false,state:'disabled',last_local:'',next_local:''}};
      window.fetchOkJson = async (url, options) => { calls.push({url,method:options.method||'GET'}); return {...payload}; };
      window.configDocFor = (name, key) => docs[name + '/' + key];
      window.closeColorPickerPopover = window.closeDependencyMaskPopover = () => {};
      window.configEnumOptionsForField = () => null;
      window.normalizeDigitalInputConfigKey = () => '';
      window.isDigitalInputConfigModule = () => false;
      window.cfgDocPathCandidates = name => [name];
      window.nettoyerNomFlowCfg = name => name;
      window.buildFlowSwitch = ({checked, label}) => {
        const element = document.createElement('label'); const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label',label); element.append(input);
        return {element,input};
      };
      eval(functions + `
        window.preview = loadPoolAiPreview; window.status = loadPoolAiStatus; window.render = renderPoolAiInsight;
        window.tick = async () => { const timer = timers.get(poolAiPreviewPollTimer); timers.delete(poolAiPreviewPollTimer); return timer.callback(); };
        window.build = () => renderConfigFields(flowCfgFields,'ai/openai',
          {daily_time:'08:00',automatic_enabled:false,model:'gpt-4o-mini',api_key:'***',enabled:false},
          {controlsPrimaryPane:true});
        flowCfgApplyBtn.onclick = () => saves.push(JSON.parse(buildPatchJsonFromFields(flowCfgFields,'ai/openai')));
        window.patch = () => buildPatchJsonFromFields(flowCfgFields,'ai/openai');
        window.poll = schedulePoolAiStatusPolling;
        window.manual = requestPoolAiInsight;
      `);
    }, {functions, docs});
    await page.evaluate(() => preview(true,0));
    assert.equal(await page.evaluate(() => calls[0].url), '/api/ai/pool-preview?refresh=1');
    assert.equal(await page.evaluate(() => timers.get(poolAiPreviewPollTimer).delay),1000);
    await page.evaluate(() => { payload.weather_state='ready'; payload.weather_text='Weather available'; });
    await page.evaluate(() => tick());
    assert.equal(await page.locator('#poolAiWeatherText').textContent(),'Weather available');
    assert.equal(await page.evaluate(() => timers.get(poolAiPreviewPollTimer).delay),60000);
    assert.equal(await page.locator('#poolAiNextAnalysis').textContent(),'Désactivée');
    await page.evaluate(() => {
      payload = {...payload, enabled:true, api_key_configured:true, insight_state:'ready',insight_text:'Recommendation',
        insight_generated_at_utc:100,schedule:{enabled:true,state:'ready',last_generated_at_utc:100,last_local:'07/10/2026 08:00',next_local:'08/10/2026 08:00'}};
    });
    const reads = await page.evaluate(() => calls.length);
    await page.evaluate(() => tick());
    assert.equal(await page.evaluate(() => calls.length),reads+1,'Regular poll uses only the lightweight endpoint');
    assert.equal(await page.evaluate(() => calls.at(-1).url),'/api/ai/pool-status');
    assert.equal(await page.locator('#poolAiNextAnalysis').textContent(),'08/10/2026 08:00');
    assert.equal(await page.locator('#poolAiLastAnalysis').textContent(),'07/10/2026 08:00');
    assert.equal(await page.locator('#poolAiWeatherText').textContent(),'Weather available','Status polling preserves diagnostics');
    assert.match(await page.locator('#poolAiResultTitle').textContent(),/07\/10\/2026 08:00/,'Result uses the board local time');
    assert.equal(await page.evaluate(() => calls.some(call=>call.method==='POST')),false,'Passive polling never launches an OpenAI analysis');
    await page.evaluate(() => { payload.insight_state='loading'; poll(payload,90); });
    assert.equal(await page.evaluate(() => timers.get(poolAiPreviewPollTimer).delay),60000);
    await page.evaluate(() => { pageId='page-control'; poll(payload,0); });
    assert.equal(await page.evaluate(() => timers.size),0,'Polling stops outside the dashboard');
    await page.evaluate(() => build());
    assert.deepEqual(await page.locator('#fields [data-key]').evaluateAll(nodes=>nodes.map(node=>node.dataset.key)),
      ['enabled','api_key','model','automatic_enabled','daily_time']);
    const time = page.locator('input[data-key="daily_time"]');
    assert.equal(await time.isEnabled(),false);
    await page.locator('input[data-key="automatic_enabled"]').check();
    assert.equal(await time.isEnabled(),true);
    await time.fill('09:30'); await time.press('Tab');
    assert.equal(await page.evaluate(() => saves.length),0,'Changes remain drafts until Apply');
    await page.getByRole('button',{name:'Appliquer'}).click();
    assert.equal(await page.evaluate(() => saves[0]['ai/openai'].daily_time),'09:30');
    assert.equal(await page.evaluate(() => saves[0]['ai/openai'].automatic_enabled),true);
    await time.fill('');
    assert.equal(await page.getByRole('button',{name:'Appliquer'}).isEnabled(),false,'Blank time cannot be saved while active');
    await page.locator('input[data-key="automatic_enabled"]').uncheck();
    assert.equal(await page.getByRole('button',{name:'Appliquer'}).isEnabled(),false,'Unchanged inactive state does not create a patch');
    await page.locator('input[data-key="model"]').fill('another-model');
    assert.equal(await page.getByRole('button',{name:'Appliquer'}).isEnabled(),true);
    assert.equal(await page.evaluate(() => 'daily_time' in JSON.parse(patch())['ai/openai']),false,'Inactive time is omitted, preserving the stored hour');
    console.log('AI schedule: explicit validation, dependent hour, board time, safe status polling and weather refresh without OpenAI calls passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
