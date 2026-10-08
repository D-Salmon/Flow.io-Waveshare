'use strict';
// Exercise the complete shipped application, including renamed local bindings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require('playwright');
const dataRoot = path.resolve(__dirname, '../../data');
const json = file => JSON.parse(fs.readFileSync(path.join(dataRoot, file), 'utf8'));
const index = json('wc/i.j');
const manifestHeader = fs.readFileSync(path.resolve(dataRoot, '../src/Core/Generated/RuntimeUiManifestJson_Generated.h'), 'utf8');
const manifest = JSON.parse(manifestHeader.match(/R"RUI\(([\s\S]*?)\)RUI"/)[1]);

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const errors = [], writes = [], shippedAssets = new Set();
    const modules = {
      'poollogic/modes': {auto_mode:true, ph_auto_mode:true, orp_auto_mode:true, disinfection_type:1},
      'poollogic/heater': {heater_auto_mode:true, heater_setpoint:28.5},
      'poollogic/regulation': {enabled:true, dly_pid_min:2, pid_min_on_ms:1000, pid_sample_ms:10000},
      'poollogic/sensors': {},
      'io/drivers/expander00': {enabled:true, address:32, secondary_address:0, mask_default:0}
    };
    let lighting = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://flowio.local/**', async route => {
      const request = route.request(), url = new URL(request.url()), name = url.pathname;
      if (name.startsWith('/api/')) {
        let body = {ok:true};
        if (name === '/api/web/meta') body = {ok:true,web_asset_version:'production-dashboard',profile:'waveshare',auth_enabled:true,auth_required:false};
        if (name === '/api/auth/session') body = {ok:true,authenticated:true,role:'admin',username:'admin'};
        if (name === '/api/flowcfg/module') body = {ok:true,data:modules[url.searchParams.get('name')] || {lang:'fr'}};
        if (name === '/api/flowcfg/batch') body = {ok:true,modules:Object.fromEntries(
          JSON.parse(url.searchParams.get('names')).map(name => [name,modules[name] || {}]))};
        if (name === '/api/flowcfg/apply') {
          const patch = JSON.parse(new URLSearchParams(request.postData()).get('patch'));
          writes.push({name,patch});
          for (const [module,fields] of Object.entries(patch)) Object.assign(modules[module] ||= {},fields);
        }
        if (name === '/api/runtime/manifest') body = manifest;
        if (name === '/api/runtime/values') body = {ok:true,values:
          (url.searchParams.get('ids') || '').split(',').map(id => ({id:Number(id),value:false,available:true}))};
        if (name === '/api/runtime/dashboard_slots') body = {ok:true,slots:[],alarm_slots:[]};
        if (name === '/api/runtime/pooldevice_options') body = {ok:true,options:[
          {value:6,domainSlot:22,name:'Lights',controllable:true,actualOn:lighting,desiredOn:lighting}]};
        if (name === '/api/runtime/action') {
          const fields = Object.fromEntries(new URLSearchParams(request.postData()));
          writes.push({name,fields}); lighting = fields.input === 'true';
        }
        if (name === '/api/cfgdoc/index') body = index;
        if (name === '/api/cfgdoc/module') body = json('wc/' + index.modules[url.searchParams.get('name')]);
        if (name === '/api/cfgdoc/i18n') body = json('wc/i18n.' + url.searchParams.get('locale') + '.j');
        if (name === '/api/flowcfg/children') {
          const prefix = url.searchParams.get('prefix') || '';
          const all = Object.keys(modules);
          body = {ok:true,has_exact:all.includes(prefix),children:[...new Set(all
            .filter(name => name.startsWith(prefix ? prefix+'/' : ''))
            .map(name => name.slice(prefix ? prefix.length+1 : 0).split('/')[0]))]};
        }
        return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      }
      const file = path.join(dataRoot, name === '/webinterface' ? 'webinterface/index.html' : name);
      if (!fs.existsSync(file)) return route.fulfill({status:404});
      if (!/\.(js|css|html|json)$/.test(file)) return route.fulfill({body:fs.readFileSync(file)});
      assert(fs.existsSync(file+'.gz'), 'Use the shipped compressed asset: '+name);
      shippedAssets.add(name);
      return route.fulfill({body:zlib.gunzipSync(fs.readFileSync(file+'.gz')),
        contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',
        headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
    });
    await page.goto('http://flowio.local/webinterface?full=1&page=page-dashboard');
    const setpoint = page.locator('[data-module="poollogic/heater"][data-key="heater_setpoint"]');
    await setpoint.waitFor();
    assert.equal(await setpoint.inputValue(),'28.5');
    await setpoint.fill('29');
    await setpoint.blur();
    assert.equal(writes.length,0,'Editing and blur cannot save configuration');
    const apply = setpoint.locator('..').locator('button');
    await apply.click();
    await page.waitForFunction(() => document.querySelector('[data-key="heater_setpoint"]').dataset.initialValue === '29');
    assert.deepEqual(writes.shift(),{name:'/api/flowcfg/apply',patch:{'poollogic/heater':{heater_setpoint:29}}});
    const lightingButton = page.locator('#poolLightingControl button');
    await lightingButton.waitFor();
    await lightingButton.click();
    await page.waitForFunction(() => document.querySelector('#poolLightingControl button').textContent.includes('Allumé'));
    const equipment = manifest.values.find(entry => entry.displayConfig?.actionDialog?.layout === 'equipment-management');
    const column = equipment.displayConfig.actionDialog.columns.find(column => column.type === 'switch');
    assert.deepEqual(writes.shift(),{name:'/api/runtime/action',fields:{runtime_id:String(equipment.id),action_id:column.action,input:'true',target:'6'}});
    assert.equal(writes.length,0,'Commands cannot cause unrelated writes');
    assert(shippedAssets.has('/webinterface/app.js') && shippedAssets.has('/webinterface/app-core.js'));
    assert.deepEqual(errors,[]);
    console.log('Production dashboard: shipped scripts, explicit field validation and lighting action passed.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
