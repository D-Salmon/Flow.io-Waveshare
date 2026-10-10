'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require('playwright');
const dataRoot = path.resolve(__dirname, '../../data');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const requests = [], errors = [], writes = [], gates = new Map(), failures = new Set();
    let accounts = [{username:'admin',role:'admin'}], role = 'admin', localOperator = false;
    let firmware = '3.5.0+20261008.223630';
    const pendingReceipt = {ok:true,state:'idle',boot_id:2,
      last_operation:{operation_id:42,result:'succeeded',target:'waveshare'}};
    const routeRequest = async route => {
      const url = new URL(route.request().url()), name = url.pathname;
      requests.push({name, method:route.request().method(), query:url.search});
      if (name === '/login') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Connexion</title>'});
      if (name.startsWith('/api/')) {
        let data = {ok:true};
        if (name === '/api/web/meta') data = {ok:true,web_asset_version:'management-test',
          firmware_version:firmware,profile:'waveshare',auth_enabled:true,auth_required:false};
        if (name === '/api/auth/session') data = {ok:true,authenticated:!localOperator,local_operator:localOperator,role,username:role};
        if (name === '/api/flowcfg/batch') data = {ok:true,modules:Object.fromEntries(
          JSON.parse(url.searchParams.get('names')).map(name => [name, {}]))};
        if (name === '/api/activity/logs') data = {ok:true,entries:0,count:0,complete:true,events:[]};
        if (name === '/api/auth/users') {
          if (route.request().method() === 'POST') {
            const fields = Object.fromEntries(new URLSearchParams(route.request().postData()));
            writes.push({name,fields}); accounts = accounts.filter(a => a.username !== fields.username);
            accounts.push({username:fields.username,role:fields.role});
          }
          data = {ok:true,accounts};
        }
        if (name === '/api/auth/password') writes.push({name,fields:Object.fromEntries(new URLSearchParams(route.request().postData()))});
        if (name === '/api/fwupdate/status') data = pendingReceipt;
        if (name === '/api/fwupdate/check') data = route.request().method() === 'POST'
          ? {ok:true,request_id:7} : {ok:true,state:'ready',manifest:{version:'3.5.1',
            waveshare:{version:'3.5.1',url:'firmware.bin'}},manifest_url:'https://example.test/manifest.json'};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      }
      if (failures.has(name)) return route.fulfill({status:404});
      if (gates.has(name)) await gates.get(name).promise;
      const file = path.join(dataRoot, name === '/webinterface' ? 'webinterface/index.html' : name);
      if (!fs.existsSync(file)) return route.fulfill({status:404});
      const body = process.env.FLOWIO_TEST_MINIFIED && fs.existsSync(file+'.gz')
        ? zlib.gunzipSync(fs.readFileSync(file+'.gz')) : fs.readFileSync(file);
      return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',
        headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
    };
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://flowio.local/**', routeRequest);
    await page.addInitScript(() => sessionStorage.setItem('flow_upgrade_ui_session', JSON.stringify({phase:'done',awaitingReconnect:false})));
    await page.goto('http://flowio.local/webinterface?full=1&page=page-dashboard');
    await page.waitForFunction(() => window.__FLOW_WEB_APP_READY__ === true);
    const count = name => requests.filter(r => r.name === name).length;
    const open = id => page.locator('[data-page="' + id + '"]').first().click();
    for (const name of ['activity','users','updates']) assert.equal(count('/webinterface/'+name+'.js'),0);
    assert.equal(count('/api/fwupdate/status'),0);
    for (const [module,id,api,ready] of [
      ['activity','page-activity-log','/api/activity/logs',() => document.querySelector('#activityLogStatus').textContent.includes('événement')],
      ['users','page-users','/api/auth/users',() => document.querySelectorAll('.users-row').length === 1],
      ['updates','page-system','/api/fwupdate/status',() => document.querySelectorAll('#upgradeTableBody .upgrade-component-card').length > 0]
    ]) {
      const asset = '/webinterface/'+module+'.js';
      let release; const promise = new Promise(resolve => {release=resolve;}); gates.set(asset,{promise});
      const before = count(api);
      await open(id);
      for (let i=0; !count(asset) && i<100; ++i) await pause(20);
      assert.equal(count(asset),1);
      await open('page-dashboard'); release();
      await page.waitForFunction(name => !!window.FlowWebPages?.[name], module);
      assert.equal(count(api),before,'Leaving during '+module+' download prevents obsolete reads');
      await open(id);
      if (module === 'updates') await page.waitForFunction(() => document.querySelector('#upgradeTableBody').children.length > 0);
      else await page.waitForFunction(ready);
      for (let i=0; count(api)===before && i<100; ++i) await pause(20);
      assert(count(api)>before);
      assert.equal(count(asset),1,'Reopening reuses the downloaded module');
    }
    await page.locator('#checkUpdates').click();
    await page.waitForFunction(() => document.querySelector('#upgradeFooterStatus').textContent.includes('Manifest vérifié') || document.querySelector('#upgradeFooterStatus').textContent.includes('disponible(s)'));
    assert.equal(requests.filter(r => r.name === '/api/fwupdate/check' && r.method === 'POST').length,1);
    assert.equal(requests.filter(r => r.name === '/api/fwupdate/check' && r.query.includes('request_id=7')).length,1);
    await open('page-users');
    assert.equal(await page.locator('.users-row .danger-action').count(),0,'Last administrator remains protected');
    await page.locator('#usersAddBtn').click();
    await page.locator('#userUsername').fill('operator-test');
    await page.locator('#userPassword').fill('local-test-password');
    await page.locator('#userSaveBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.users-row').length === 2);
    assert.equal(writes.length,1);
    assert.equal(writes[0].fields.role,'operator');
    assert.equal(await page.locator('.users-row .danger-action').count(),1);
    await page.locator('#accountProfile').click();
    await page.waitForFunction(() => document.querySelector('#accountDialog').open);
    await page.locator('#ownPassword').fill('new-local-test-password');
    await page.locator('#ownPasswordBtn').click();
    await page.waitForFunction(() => document.querySelector('#ownPasswordStatus').textContent.includes('mis à jour'));
    assert.equal(writes.length,2); assert.equal(await page.locator('#ownPassword').inputValue(),'');
    await page.locator('#accountDialogClose').click();
    assert.equal(count('/webinterface/users.js'),1,'Profile dialog reuses Accounts module');
    await open('page-dashboard'); const stopped = count('/api/fwupdate/status');
    await pause(1600); assert.equal(count('/api/fwupdate/status'),stopped,'Inactive updates page stops polling');

    // Resume a pending operation even when the initial page is Dashboard.
    const resume = await browser.newPage(); resume.on('pageerror',e=>errors.push(e.message));
    await resume.route('http://flowio.local/**',routeRequest);
    await resume.addInitScript(() => sessionStorage.setItem('flow_upgrade_ui_session', JSON.stringify({
      phase:'reconnect',target:'waveshare',awaitingReconnect:true,reconnectShown:true,operationId:42})));
    await resume.goto('http://flowio.local/webinterface?full=1&page=page-dashboard');
    await resume.waitForFunction(() => JSON.parse(sessionStorage.getItem('flow_upgrade_ui_session') || '{}').phase === 'done');
    assert.equal(await resume.locator('#page-dashboard').evaluate(n=>n.classList.contains('active')),true);
    await resume.close();

    // Optional module failures leave the application operational and can be retried.
    const failed = await browser.newPage(); failed.on('pageerror',e=>errors.push(e.message));
    await failed.route('http://flowio.local/**',routeRequest);
    failures.add('/webinterface/users.js');
    await failed.goto('http://flowio.local/webinterface?full=1&page=page-users');
    await failed.waitForFunction(() => document.querySelector('#usersListStatus')?.textContent.includes('Rouvrez la page'));
    assert.equal(await failed.evaluate(() => window.__FLOW_WEB_BOOT_ERROR__),undefined);
    await failed.locator('[data-page="page-dashboard"]').first().click(); failures.clear();
    await failed.locator('[data-page="page-users"]').first().click();
    await failed.waitForFunction(() => document.querySelectorAll('.users-row').length === 2);
    // Global logout must work before the optional Accounts module is loaded.
    // Opening the profile first must not bind a second logout handler.
    for (const scenario of [
      {role:'operator',local:true,profile:false},
      {role:'operator',local:false,profile:false},
      {role:'admin',local:false,profile:false},
      {role:'operator',local:false,profile:true}
    ]) {
      role = scenario.role; localOperator = scenario.local;
      const logoutPage = await browser.newPage();
      logoutPage.on('pageerror',error=>errors.push(error.message));
      await logoutPage.route('http://flowio.local/**',routeRequest);
      const usersBefore = count('/webinterface/users.js');
      await logoutPage.goto('http://flowio.local/webinterface?full=1&page=page-dashboard');
      await logoutPage.waitForFunction(() => window.__FLOW_WEB_APP_READY__ === true);
      assert.equal(count('/webinterface/users.js'),usersBefore,'Logout readiness does not require downloading Accounts');
      if (scenario.profile) {
        await logoutPage.locator('#accountProfile').click();
        await logoutPage.locator('#accountDialog[open]').waitFor();
        await logoutPage.locator('#accountDialogClose').click();
      }
      const beforeLogout = count('/api/auth/logout');
      await logoutPage.locator('#accountLogout').click();
      await logoutPage.waitForURL('http://flowio.local/login');
      assert.equal(count('/api/auth/logout')-beforeLogout,scenario.local ? 0 : 1,
        'Local access redirects directly; authenticated access sends exactly one logout request');
      await logoutPage.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Optional management pages: no eager downloads, canceled navigation, module reuse, Accounts/profile/last administrator, update check, inactive polling, off-page reconnect receipt and retry passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
