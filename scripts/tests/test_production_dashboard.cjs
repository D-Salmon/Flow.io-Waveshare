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
      'poollogic/modes': {auto_mode:true, ph_auto_mode:true, orp_auto_mode:true, disinfection_type:1, winter_mode:false},
      'poollogic/heater': {heater_auto_mode:true, heater_setpoint:28.5},
      'poollogic/swg': {swg_control_mode:0, dly_elec_min:2, secure_elec_t:15},
      'poollogic/chlorine': {dis_setpoint:700, dis_auto_mode:true},
      'poollogic/regulation': {enabled:true, dly_pid_min:2, pid_min_on_ms:1000, pid_sample_ms:10000},
      'poollogic/safety': {winter_start_t:-2, freeze_hold_t:2, sensor_hold_wat:false},
      'poollogic/sensors': {},
      'io/drivers/expander00': {enabled:true, address:32, secondary_address:0, mask_default:0}
    };
    let lighting = false, actionFailure = null;
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
          writes.push({name,fields});
          if (actionFailure) body = {ok:false,err:actionFailure};
          else lighting = fields.input === 'true';
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
    const winterThreshold = page.locator('[data-key="winter_start_t"]');
    assert(await winterThreshold.isHidden(),'Winter start threshold is hidden outside winter mode');
    assert(await page.locator('[data-key="freeze_hold_t"]').isVisible(),'Freeze hold remains visible year round');
    assert.deepEqual(await page.locator('[data-module="poollogic/safety"] .control-row input, [data-module="poollogic/safety"] .control-row select')
      .evaluateAll(fields => fields.map(field => field.dataset.key)), ['winter_start_t','freeze_hold_t','sensor_hold_wat']);
    const orpSelector = '#poolDisinfectionModes [data-module="poollogic/chlorine"][data-key="dis_setpoint"]';
    const orp = page.locator(orpSelector);
    await orp.waitFor();
    assert.equal(await orp.inputValue(),'700');
    assert.match(await orp.locator('..').locator('..').innerText(), /Consigne ORP \(mV\)/);
    await orp.focus();
    await orp.press('ArrowUp');
    assert.equal(await orp.inputValue(),'701','ORP increments by one millivolt');
    await orp.press('ArrowDown');
    assert.equal(await orp.inputValue(),'700','ORP decrements by one millivolt');
    assert.equal(writes.length,0,'Using ORP arrows still requires validation');
    await orp.fill('720');
    await orp.blur();
    assert.equal(writes.length,0,'ORP editing and blur cannot save configuration');
    await orp.locator('..').locator('button').click();
    await page.waitForFunction(selector => document.querySelector(selector)?.dataset.initialValue === '720',orpSelector);
    assert.deepEqual(writes.shift(),{name:'/api/flowcfg/apply',patch:{'poollogic/chlorine':{dis_setpoint:720}}});
    const mode = page.locator('#poolDisinfectionModes [data-key="swg_control_mode"]');
    await mode.selectOption('1');
    assert.equal(writes.length,0,'Changing the control mode also requires explicit validation');
    assert.equal(await orp.count(),1,'A draft control mode cannot hide the saved ORP setting');
    await mode.locator('..').locator('button').click();
    await page.waitForFunction(() => !document.querySelector('#poolDisinfectionModes [data-key="dis_setpoint"]') &&
      document.querySelector('#poolDisinfectionModes [data-key="swg_control_mode"]')?.value === '1');
    assert.deepEqual(writes.shift(),{name:'/api/flowcfg/apply',patch:{'poollogic/swg':{swg_control_mode:1}}});
    assert.equal(modules['poollogic/chlorine'].dis_setpoint,720,'Continuous mode preserves the ORP setpoint');
    await mode.selectOption('0');
    await mode.locator('..').locator('button').click();
    await orp.waitFor();
    assert.equal(await orp.inputValue(),'720','Returning to ORP mode reads the shared saved value');
    assert.deepEqual(writes.shift(),{name:'/api/flowcfg/apply',patch:{'poollogic/swg':{swg_control_mode:0}}});
    const lightingButton = page.locator('#poolLightingControl button');
    await lightingButton.waitFor();
    await lightingButton.click();
    await page.waitForFunction(() => document.querySelector('#poolLightingControl button').textContent.includes('Allumé'));
    const equipment = manifest.values.find(entry => entry.displayConfig?.actionDialog?.layout === 'equipment-management');
    const column = equipment.displayConfig.actionDialog.columns.find(column => column.type === 'switch');
    assert.deepEqual(writes.shift(),{name:'/api/runtime/action',fields:{runtime_id:String(equipment.id),action_id:column.action,input:'true',target:'6'}});
    actionFailure = {code:'InterlockBlocked',where:'poollogic.ph_pump.write',dependency:{name:'Filtration Pump',state:'off',slot:0}};
    await lightingButton.click();
    await page.waitForFunction(() => document.querySelector('#poolLightingControl').textContent.includes('Pompe de filtration doit être en marche'));
    assert(!(await page.locator('#poolLightingControl').innerText()).includes('InterlockBlocked'));
    assert((await page.locator('#poolLightingControl button').innerText()).includes('Allumé'),'A rejected command preserves the actual state');
    writes.shift();
    actionFailure = {code:'InterlockBlocked',where:'poollogic.dis_pump.write',
      safety_reasons:['pressure_unavailable','flow_absent']};
    const disinfectionEntry = manifest.values.find(entry => entry.key === 'pool.chlorine_pump_on');
    const disinfectionSelector = '[data-runtime-value-id="' + disinfectionEntry.id + '"]';
    const disinfection = page.locator(disinfectionSelector);
    await disinfection.waitFor();
    await disinfection.getByRole('switch').click();
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('mesure de pression indisponible'),disinfectionSelector);
    assert((await disinfection.innerText()).includes('ne confirme pas la présence de débit'));
    await page.waitForTimeout(8000);
    assert((await disinfection.innerText()).includes('mesure de pression indisponible'),'Refusal survives the former seven-second expiry and polling');
    writes.shift();
    assert.equal(writes.length,0,'Commands cannot cause unrelated writes');
    assert(shippedAssets.has('/webinterface/app.js') && shippedAssets.has('/webinterface/app-core.js'));
    assert.deepEqual(errors,[]);
    console.log('Production dashboard: shipped scripts, explicit validation, conditional shared ORP setpoint and lighting action passed.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
