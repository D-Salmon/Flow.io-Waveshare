const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../../data');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const errors = [], writes = [], calibrationWrites = [];
    const coefficients = {a01_c0:1.25,a01_c1:0.5};
    let mqttConnected = false;
    const wifi = {ok:true, enabled:true, ssid:'Test network', password_configured:true,
      runtime:{connected:true, ip:'192.168.31.6'},
      ethernet:{enabled:true,dhcp:true,connected:false,link_up:false,ip:'',subnet:'255.255.255.0',gateway:'',dns1:'',dns2:''}};
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://flowio.local/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        let data = {ok:true};
        if (url.pathname === '/api/flow/status/domain') data = {ok:true,wifi:{rdy:wifi.runtime.connected,typ:'wifi'},mqtt:{rdy:mqttConnected}};
        if (url.pathname === '/api/web/meta') data = {ok:true,web_asset_version:'regression',auth_enabled:true,auth_required:false};
        if (url.pathname === '/api/auth/session') data = {ok:true,authenticated:true,role:'admin',username:'admin'};
        if (url.pathname === '/api/wifi/config') {
          if (route.request().method() === 'POST') {
            const values = Object.fromEntries(new URLSearchParams(route.request().postData()));
            writes.push(values);
            if (values.scope === 'ethernet') Object.assign(wifi.ethernet,{dhcp:values.eth_dhcp==='1',ip:values.eth_ip,subnet:values.eth_subnet,gateway:values.eth_gateway});
          }
          data = wifi;
        }
        if (url.pathname === '/api/mqtt/config') data = {ok:true,enabled:false,host:'',port:8883,user:'',password_configured:true,baseTopic:'flowio'};
        if (url.pathname === '/api/flowcfg/module') {
          const name=url.searchParams.get('name');
          if (name==='poollogic/sensors') data={ok:true,data:{ph_io_id:101}};
          else if (name.startsWith('io/input/')) data={ok:true,data:coefficients};
        }
        if (url.pathname === '/api/flowcfg/apply') {
          const patch = JSON.parse(new URLSearchParams(route.request().postData()).get('patch'));
          calibrationWrites.push(patch);
          Object.assign(coefficients, patch['io/input/a01']);
        }
        if (url.pathname === '/api/runtime/values') data={ok:true,values:[]};
        if (url.pathname === '/api/wifi/scan') data = {ok:true,state:'done',networks:[{ssid:'Test network',rssi:-50}],count:1};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      }
      const file = path.join(root, url.pathname === '/webinterface' ? 'webinterface/index.html' : url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({status:404});
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',
        headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
    });
    await page.goto('http://flowio.local/webinterface?full=1&page=page-wifi');
    await page.waitForFunction(() => window.__FLOW_WEB_APP_READY__ === true);
    await page.waitForFunction(() => document.querySelector('#wifiIpAddress').textContent === '192.168.31.6');
    await page.waitForFunction(() => document.querySelector('#mqttConnectionState').textContent.includes('Déconnecté'));
    mqttConnected = true;
    wifi.ethernet.connected = true;
    wifi.ethernet.runtime_ip = '192.168.31.7';
    wifi.runtime.connected = false;
    await page.waitForFunction(() => document.querySelector('#mqttConnectionState').textContent.includes('Connecté') && document.querySelector('#ethernetConnectionState').textContent.includes('Connecté') && document.querySelector('#wifiConnectionState').textContent.includes('Déconnecté'),{},{timeout:12000});
    assert.equal(await page.locator('#mqttConnectionState span:last-child').getAttribute('data-i18n'),'network.state.connected');
    assert.equal(await page.locator('#ethernetConnectionState span:last-child').getAttribute('data-i18n'),'network.state.connected');
    assert.equal(await page.locator('#wifiConnectionState span:last-child').getAttribute('data-i18n'),'network.state.disconnected');
    await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));});
    mqttConnected = false;
    wifi.ethernet.connected = false;
    wifi.runtime.connected = true;
    await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(() => document.querySelector('#mqttConnectionState').textContent.includes('Déconnecté') && document.querySelector('#wifiConnectionState').textContent.includes('Connecté') && document.querySelector('#ethernetConnectionState').textContent.includes('Déconnecté'));
    assert.equal(await page.locator('#wifiPass').inputValue(),'');
    assert.equal(await page.locator('#mqttPass').getAttribute('maxlength'),'63');
    assert.match(await page.locator('#wifiPass').getAttribute('placeholder'),/Conserver/);
    assert.equal(await page.locator('#ethernetStaticFields').isVisible(),false);
    await page.locator('label.md3-switch').filter({has:page.locator('#ethernetDhcp')}).click();
    assert.equal(await page.locator('#ethernetDhcp').isChecked(),false);
    assert.equal(await page.locator('#ethernetStaticFields').isVisible(),true);
    await page.locator('#ethernetIp').fill('192.168.31.20');
    await page.locator('#ethernetGateway').fill('192.168.31.1');
    await page.locator('#applyEthernetCfg').click();
    await page.waitForFunction(() => document.querySelector('#applyEthernetCfg').disabled);
    assert.equal(writes.length,1);
    assert.equal(writes[0].scope,'ethernet');
    assert.equal(writes[0].eth_ip,'192.168.31.20');
    assert(!Object.hasOwn(writes[0],'pass') && !Object.hasOwn(writes[0],'ssid'));
    await page.locator('label.md3-switch').filter({has:page.locator('#ethernetDhcp')}).click();
    await page.locator('#cancelEthernetCfg').click();
    assert.equal(await page.locator('#ethernetDhcp').isChecked(),false);
    await page.locator('[data-page="page-calibration"]').click();
    await page.locator('#calibrationSensorSelect').selectOption('ph_one');
    assert.equal(await page.locator('#calibrationOnePointFields').isVisible(),true);
    assert.equal(await page.locator('#calibrationTwoPointFields').isVisible(),false);
    assert.equal(await page.locator('#page-calibration .calibration-fields-shell input:visible').count(),2);
    await page.locator('#calibrationLoadBtn').click();
    await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('Configuration chargée'));
    assert.equal(await page.locator('#calibrationC0Current').innerText(),'1,25');
    assert.equal(await page.locator('#calibrationC1Current').innerText(),'0,5');
    assert(!await page.locator('#calibrationStatus').evaluate(n=>n.classList.contains('is-error')));
    await page.locator('#calibrationSingleMeasured').fill('7');
    await page.locator('#calibrationSingleReference').fill('7.4');
    await page.locator('#calibrationComputeBtn').click();
    assert.equal(calibrationWrites.length,0, 'Computing a calibration does not save coefficients');
    await page.locator('#calibrationApplyBtn').click();
    await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('appliqué avec succès'));
    assert.deepEqual(calibrationWrites,[{'io/input/a01':{a01_c0:1.25,a01_c1:0.9}}]);
    assert.equal(await page.locator('#calibrationC1Current').innerText(),'0,9');
    await page.locator('#calibrationSensorSelect').selectOption('ph');
    assert.equal(await page.locator('#calibrationOnePointFields').isVisible(),false);
    assert.equal(await page.locator('#calibrationTwoPointFields').isVisible(),true);
    assert.equal(await page.locator('#page-calibration .calibration-fields-shell input:visible').count(),4);
    await page.locator('#calibrationLoadBtn').click();
    await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('Configuration chargée'));
    await page.locator('#calibrationPoint1Measured').fill('7');
    await page.locator('#calibrationPoint1Reference').fill('7.2');
    await page.locator('#calibrationPoint2Measured').fill('4');
    await page.locator('#calibrationPoint2Reference').fill('4.2');
    await page.locator('#calibrationComputeBtn').click();
    await page.locator('#calibrationApplyBtn').click();
    await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('appliqué avec succès'));
    assert.deepEqual(calibrationWrites[1],{'io/input/a01':{a01_c0:1.25,a01_c1:1.1}});
    await page.locator('#calibrationPoint2Measured').fill('7');
    await page.locator('#calibrationComputeBtn').click();
    assert.equal(await page.locator('#calibrationApplyBtn').isDisabled(),true);
    assert.equal(calibrationWrites.length,2, 'An invalid pair cannot be saved');
    await page.locator('#calibrationSensorSelect').selectOption('water_temp');
    assert.equal(await page.locator('#page-calibration .calibration-fields-shell input:visible').count(),2);
    assert.deepEqual(errors,[]);
    console.log('Full UI: network state, secret retention, scoped save/cancel, one/two-point calibration, explicit coefficient save and invalid-pair rejection passed');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
