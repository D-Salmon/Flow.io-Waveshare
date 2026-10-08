'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const dataRoot = path.resolve(__dirname, '../../data');
const index = JSON.parse(fs.readFileSync(path.join(dataRoot, 'wc/i.j'), 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const storeModules = ['wifi', 'ethernet', ...Array.from({length: 16}, (_, i) => 'io/output/d' + String(i).padStart(2, '0'))];

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const errors = [], requests = [], moduleRequests = [], intervals = {};
    let releaseHistory, releaseNetwork, releaseCalibration, failHistory = false, failCalibration = false;
    const historyGate = new Promise(resolve => { releaseHistory = resolve; });
    const networkGate = new Promise(resolve => { releaseNetwork = resolve; });
    const calibrationGate = new Promise(resolve => { releaseCalibration = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    async function routeRequest(route) {
      const url = new URL(route.request().url()), name = url.pathname;
      requests.push(name);
      if (name.startsWith('/api/')) {
        let data = {ok: true};
        if (name === '/api/web/meta') data = {ok:true,web_asset_version:'lazy-test',auth_enabled:true,auth_required:false};
        if (name === '/api/auth/session') data = {ok:true,authenticated:true,role:'admin',username:'admin'};
        if (name === '/api/flow/status/domain') data = {ok:true,wifi:{rdy:true,typ:'wifi'},mqtt:{rdy:true}};
        if (name === '/api/flowcfg/module') data = {ok:true,data:url.searchParams.get('name') === 'wifi'
          ? {enabled:true,ssid:'Test network',pass:'***'} : url.searchParams.get('name') === 'ethernet'
          ? {enabled:true,dhcp:true} : {lang:'fr'}};
        if (name === '/api/flowcfg/module') {
          const module = url.searchParams.get('name'); moduleRequests.push(module);
          if (module === 'poollogic/sensors') data = {ok:true,data:{ph_io_id:193}};
          if (module === 'io/input/a01') data = {ok:true,data:{a01_c0:1.25,a01_c1:0.5}};
        }
        if (name === '/api/flowcfg/batch') data = {ok:true,modules:Object.fromEntries(
          JSON.parse(url.searchParams.get('names')).map(name => [name, {}]))};
        if (name === '/api/flowcfg/children') {
          const prefix = url.searchParams.get('prefix') || '';
          const children = storeModules.filter(name => name.startsWith(prefix ? prefix + '/' : ''))
            .map(name => name.slice(prefix ? prefix.length + 1 : 0).split('/')[0]);
          data = {ok:true,has_exact:storeModules.includes(prefix),children:[...new Set(children)]};
        }
        if (name === '/api/cfgdoc/index') data = index;
        if (name === '/api/cfgdoc/module') {
          const chunk = index.modules[url.searchParams.get('name')];
          data = chunk ? JSON.parse(fs.readFileSync(path.join(dataRoot, 'wc', chunk), 'utf8')) : {ok:true,docs:{}};
        }
        if (name === '/api/cfgdoc/i18n') data = JSON.parse(fs.readFileSync(path.join(dataRoot, 'wc/i18n.fr.j'), 'utf8'));
        if (name === '/api/wifi/scan') data = {ok:true,state:'done',networks:[{ssid:'Test network',secure:true,rssi:-40}]};
        if (name === '/api/history/pool') data = {ok:true,ready:true,days:[],values:[]};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      }
      if (name === '/webinterface/history.js') {
        if (failHistory) return route.fulfill({status:404});
        await historyGate;
      }
      if (name === '/webinterface/network.js') await networkGate;
      if (name === '/webinterface/calibration.js') {
        if (failCalibration) return route.fulfill({status:404});
        await calibrationGate;
      }
      if (name === '/webinterface/app-core.css' || name === '/webinterface/sh.html') {
        intervals[name] = {start:Date.now()};
        await pause(80);
        intervals[name].end = Date.now();
      }
      const file = path.join(dataRoot, name === '/webinterface' ? 'webinterface/index.html' : name);
      if (!fs.existsSync(file)) return route.fulfill({status:404});
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',
        headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
    }
    await page.route('http://flowio.local/**', routeRequest);
    const openMenu = async id => page.locator('[data-page="' + id + '"]').first().click();
    await page.goto('http://flowio.local/webinterface?full=1&page=page-dashboard');
    await page.waitForFunction(() => window.__FLOW_WEB_APP_READY__ === true && document.querySelector('#page-dashboard').classList.contains('active'));
    const css = intervals['/webinterface/app-core.css'], shell = intervals['/webinterface/sh.html'];
    assert(css.start < shell.end && shell.start < css.end, 'Styles and shell download concurrently');
    assert(!requests.includes('/webinterface/network.js'));
    assert(!requests.includes('/webinterface/network.css'));
    assert(!requests.includes('/webinterface/history.js'));
    assert(!requests.includes('/webinterface/calibration.js'));
    await openMenu('page-history');
    for (let i = 0; !requests.includes('/webinterface/history.js') && i < 100; ++i) await pause(20);
    assert(requests.includes('/webinterface/history.js'));
    await openMenu('page-dashboard');
    releaseHistory();
    await page.waitForFunction(() => !!window.FlowWebPages?.history);
    assert(!requests.includes('/api/history/pool'), 'Leaving during script download cannot start an obsolete history read');
    await openMenu('page-history');
    await page.waitForFunction(() => document.querySelector('#historyStatus').textContent.includes('actualisées'));
    assert.equal(requests.filter(name => name === '/webinterface/history.js').length, 1);
    assert.equal(requests.filter(name => name === '/api/history/pool').length, 1);
    await openMenu('page-control');
    const tree = page.locator('#flowCfgTree');
    await tree.locator('.cfg-tree-node').filter({hasText:/^réseau$/}).click();
    // Use the generated tree label for the Wi-Fi alias (distinct from its store path).
    const wifiLabel = index.docs['network/wifi'].label;
    await tree.locator('.cfg-tree-node').filter({hasText:new RegExp('^' + wifiLabel + '$')}).last().click();
    for (let i = 0; !requests.includes('/webinterface/network.js') && i < 100; ++i) await pause(20);
    assert(requests.includes('/webinterface/network.js'));
    await tree.locator('.cfg-tree-node').filter({hasText:/^ethernet$/}).click();
    await page.waitForSelector('#flowCfgFields [data-key="dhcp"]');
    releaseNetwork();
    await page.waitForFunction(() => !!window.FlowWebPages?.network);
    await pause(100);
    assert.equal(await page.locator('#flowCfgFields [data-key="ssid"]').count(), 0,
      'A late Wi-Fi module download cannot replace the selected Ethernet editor');
    await tree.locator('.cfg-tree-node').filter({hasText:new RegExp('^' + wifiLabel + '$')}).last().click();
    await page.waitForSelector('#flowCfgFields .config-wifi-selector');
    assert.equal(requests.filter(name => name === '/webinterface/network.js').length, 1);
    assert.equal(requests.filter(name => name === '/webinterface/network.css').length, 1);
    assert.equal(await page.locator('#flowCfgFields [data-key="ssid"]').inputValue(), 'Test network');
    const sensorReads = () => moduleRequests.filter(name => name === 'poollogic/sensors').length;
    const beforeCalibration = sensorReads();
    await openMenu('page-calibration');
    for (let i = 0; !requests.includes('/webinterface/calibration.js') && i < 100; ++i) await pause(20);
    assert(requests.includes('/webinterface/calibration.js'));
    await openMenu('page-dashboard'); releaseCalibration();
    await page.waitForFunction(() => !!window.FlowWebPages?.calibration);
    assert.equal(sensorReads(), beforeCalibration, 'Leaving during download cannot start calibration reads');
    const docReads = requests.filter(name => name.startsWith('/api/cfgdoc/')).length;
    await openMenu('page-calibration');
    await page.waitForFunction(() => document.querySelector('#calibrationStatus').textContent.includes('Configuration chargée'));
    assert.equal(sensorReads(), beforeCalibration + 1);
    assert.equal(requests.filter(name => name.startsWith('/api/cfgdoc/')).length, docReads,
      'Calibration coefficients do not require configuration documentation');
    assert.equal(requests.filter(name => name === '/webinterface/calibration.js').length, 1);
    assert.equal(await page.locator('#calibrationC0Current').innerText(), '1,25');
    assert.deepEqual(errors, []);
    // Failure of an optional page must leave the application usable and permit retry.
    const failedPage = await browser.newPage();
    failedPage.on('pageerror', error => errors.push(error.message));
    await failedPage.route('http://flowio.local/**', routeRequest);
    failHistory = true;
    await failedPage.goto('http://flowio.local/webinterface?full=1&page=page-history');
    await failedPage.waitForFunction(() => document.querySelector('#historyStatus')?.textContent.includes('indisponible'));
    assert.equal(await failedPage.evaluate(() => window.__FLOW_WEB_BOOT_ERROR__), undefined);
    failHistory = false;
    await failedPage.locator('#historyRefresh').click();
    await failedPage.waitForFunction(() => document.querySelector('#historyStatus').textContent.includes('actualisées'));
    failCalibration = true;
    await failedPage.locator('[data-page="page-calibration"]').first().click();
    await failedPage.waitForFunction(() => document.querySelector('#calibrationStatus').textContent.includes('Rouvrez la page'));
    assert.equal(await failedPage.locator('#page-calibration').evaluate(node => node.inert), false);
    await failedPage.locator('[data-page="page-dashboard"]').first().click();
    failCalibration = false;
    await failedPage.locator('[data-page="page-calibration"]').first().click();
    await failedPage.waitForFunction(() => document.querySelector('#calibrationStatus').textContent.includes('Configuration chargée'));
    assert.deepEqual(errors, []);
    console.log('Page loading: parallel bootstrap, optional network/history/calibration, navigation cancellation, Wi-Fi selector, calibration without docs, deduplication and failed-module retry passed.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode = 1;});
