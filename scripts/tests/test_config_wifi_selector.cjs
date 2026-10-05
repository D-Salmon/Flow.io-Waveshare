const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="fields"><input id="ssid" value="Current network"></div>');
    await page.addScriptTag({path:path.join(root, 'data/webinterface/network.js')});
    await page.evaluate(() => {
      window.calls=[]; window.edits=0;
      const input=document.querySelector('#ssid');
      input.addEventListener('input',()=>window.edits++);
      window.FlowWebPages.network.attachWifiSelector(input, document.querySelector('#fields'), {
        createFormPostOptions: values=>({method:'POST',values}),
        fetchOkJson: async (url,options)=>{
          window.calls.push({url,method:options.method||'GET'});
          return {ok:true, networks:[{ssid:'New network',secure:true,rssi:-50},{ssid:'Hidden',hidden:true}]};
        }
      });
    });
    const select=page.getByRole('combobox',{name:'Réseaux Wi-Fi disponibles'});
    await select.selectOption('New network');
    assert.equal(await page.locator('#ssid').inputValue(),'New network');
    assert.equal(await page.locator('#ssid').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.edits),1);
    await select.selectOption('');
    assert.equal(await page.locator('#ssid').isVisible(),true);
    await page.locator('#ssid').fill('Manual network');
    await page.getByRole('button',{name:'Rechercher les réseaux'}).click();
    await page.waitForFunction(()=>window.calls.some(c=>c.method==='POST'));
    assert.equal(await page.locator('#ssid').inputValue(),'Manual network');
    assert.equal(await select.locator('option[value="Hidden"]').count(),0);
    assert.equal(await select.locator('option[value="Manual network"]').count(),1);
    const mqtt=JSON.parse(fs.readFileSync(path.join(root,'src/Modules/Network/MQTTModule/text/cfgdocs.fr.json'))).docs;
    assert.deepEqual(Object.keys(mqtt).sort((a,b)=>mqtt[a].order-mqtt[b].order).slice(0,7),['enabled','host','port','user','pass','deviceName','baseTopic'].map(k=>'mqtt/'+k));
    const wifi=JSON.parse(fs.readFileSync(path.join(root,'src/Modules/Network/WifiModule/text/cfgdocs.fr.json'))).docs;
    assert.deepEqual(Object.keys(wifi).sort((a,b)=>wifi[a].order-wifi[b].order),['wifi/enabled','wifi/ssid','wifi/pass']);
    console.log('Shared Wi-Fi selector: scanned selection, manual SSID, refresh preservation and field ordering passed');
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
