const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../../data');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const errors = [], writes = [];
    let mqttConnected = false;
    let activityEvents = [1,2,3].map(seq=>({seq,epoch_s:Math.floor(Date.now()/1000),title:'Événement '+seq,domain_name:'system',source_name:'system'}));
    const deletions=[];
    let deleteId=0,deletePolls=0,pendingDelete=null,deleteFailure=false,deleteUnavailable=false;
    page.on('dialog',dialog=>dialog.accept());
    const wifi = {ok:true, enabled:true, ssid:'Test network', password_configured:true,
      runtime:{connected:true, ip:'192.168.31.6'},
      ethernet:{enabled:true,dhcp:true,connected:false,link_up:false,ip:'',subnet:'255.255.255.0',gateway:'',dns1:'',dns2:''}};
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://flowio.local/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        let data = {ok:true};
        if (url.pathname === '/api/flow/status/domain') data = {ok:true,wifi:{rdy:wifi.runtime.connected,typ:'wifi'},mqtt:{rdy:mqttConnected}};
        if (url.pathname === '/api/activity/logs') {
          const offset=Number(url.searchParams.get('offset'))||0,limit=Number(url.searchParams.get('limit'))||32;
          const events=[...activityEvents].sort((a,b)=>b.seq-a.seq).slice(offset,offset+limit);
          const complete=offset+events.length>=activityEvents.length;
          data={ok:true,entries:activityEvents.length,count:events.length,complete,next:complete?null:offset+events.length,events};
        }
        if (url.pathname === '/api/activity/delete') {
          const form=new URLSearchParams(route.request().postData());
          const selected=JSON.parse(form.get('sequences'));deletions.push(selected);
          if(deleteUnavailable) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,err:{code:'Busy'}})});
          pendingDelete=selected;deletePolls=0;
          data={ok:true,delete_id:++deleteId};
        }
        if (url.pathname === '/api/activity/status') {
          ++deletePolls;
          const state=deleteFailure?3:(deletePolls===1?1:2);
          if (state===2&&pendingDelete) {
            activityEvents=activityEvents.filter(event=>!pendingDelete.includes(event.seq));pendingDelete=null;
          }
          data={delete_id:deleteId,delete_state:state};
        }
        assert.notEqual(url.pathname,'/api/activity/purge');
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
        if (url.pathname === '/api/wifi/scan') data = {ok:true,state:'done',networks:[{ssid:'Test network',rssi:-50}],count:1};
        return route.fulfill({status:url.pathname==='/api/activity/delete'?202:200,contentType:'application/json',body:JSON.stringify(data)});
      }
      const file = path.join(root, url.pathname === '/webinterface' ? 'webinterface/index.html' : url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({status:404});
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',
        headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
    });
    await page.goto('http://flowio.local/webinterface?full=1&page=page-activity-log');
    await page.waitForFunction(() => window.__FLOW_WEB_APP_READY__ === true);
    await page.waitForFunction(()=>document.querySelectorAll('.activity-row-selection').length===3);
    assert.equal(await page.locator('#activityPurgeBtn').isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Sélectionner tout le filtre',exact:true}).count(),0);
    await page.locator('.activity-row-selection[data-sequence="3"]').check();
    await page.locator('#activityRefreshBtn').click();
    await page.waitForFunction(()=>document.querySelector('.activity-row-selection[data-sequence="3"]').checked);
    await page.locator('#activityPurgeBtn').click();
    assert.deepEqual(deletions,[]);
    await page.locator('#activityDeleteConfirmBtn').click();
    await page.waitForFunction(()=>document.querySelectorAll('.activity-row-selection').length===2);
    assert.deepEqual(deletions,[[3]]);
    assert.deepEqual(activityEvents.map(event=>event.seq),[1,2]);
    assert.equal(await page.locator('#activityPurgeBtn').isDisabled(),true);
    await page.locator('#activitySelectVisibleBtn').click();
    assert.equal(await page.locator('.activity-row-selection:checked').count(),2);
    await page.locator('#activitySelectVisibleBtn').click();
    assert.equal(await page.locator('.activity-row-selection:checked').count(),0);
    // PoolLogic records outside the current time range and several API pages.
    const oldEpoch=Math.floor(Date.now()/1000)-36*3600;
    const poolEvents=Array.from({length:300},(_,i)=>({seq:10+i,epoch_s:oldEpoch,title:'PoolLogic '+i,domain_name:i%2?'poollogic':'pooldevice',source_name:'auto'}));
    const otherEvents=Array.from({length:90},(_,i)=>({seq:400+i,epoch_s:oldEpoch,title:'System '+i,domain_name:'system',source_name:'system'}));
    activityEvents.push(...poolEvents,...otherEvents);
    await page.locator('#activityRefreshBtn').click();
    await page.waitForFunction(()=>!document.getElementById('activitySelectVisibleBtn').disabled);
    await page.locator('[data-activity-filter="poollogic"]').click();
    assert.equal(await page.locator('#activityPeriodScope').inputValue(),'all');
    assert.equal(await page.locator('.activity-row-selection').count(),300);
    assert.equal(await page.locator('.activity-row-selection:checked').count(),0);
    const displayed=await page.locator('.activity-row-selection').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.sequence)));
    assert.deepEqual(displayed,poolEvents.map(e=>e.seq).reverse());
    // Every filter opens the complete journal even after choosing a short range.
    const poolIds=poolEvents.map(e=>e.seq).reverse(),systemIds=otherEvents.map(e=>e.seq).reverse();
    for (const [filter,expectedIds] of [['all',[2,1,...systemIds,...poolIds]],['system',[2,1,...systemIds]],['manual',[]],['safety',[]],['poollogic',poolIds]]) {
      await page.locator('#activityPeriodScope').selectOption('period');
      await page.locator('[data-activity-filter="'+filter+'"]').click();
      assert.equal(await page.locator('#activityPeriodScope').inputValue(),'all');
      assert.equal(await page.locator('.activity-row-selection').count(),expectedIds.length);
      const order=await page.locator('.activity-row-selection').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.sequence)));
      assert.deepEqual(order,expectedIds);
    }
    await page.locator('#activityRefreshBtn').click();
    await page.waitForFunction(()=>!document.getElementById('activitySelectVisibleBtn').disabled);
    assert.equal(await page.locator('.activity-row-selection').count(),300);
    await page.getByRole('button',{name:'Sélectionner les événements',exact:true}).click();
    assert.equal(await page.locator('#activityPeriodScope').inputValue(),'all');
    assert.equal(await page.locator('.activity-row-selection:checked').count(),300);
    assert.match(await page.locator('#activitySelectionCount').innerText(),/300/);
    await page.locator('#activityPurgeBtn').click();
    await page.locator('#activityDeleteCancelBtn').click();
    assert.equal(deletions.length,1);
    await page.locator('#activityPurgeBtn').click();
    await page.locator('#activityDeleteConfirmBtn').click();
    await page.waitForFunction(()=>document.getElementById('activityLogStatus').textContent==='Sélection supprimée.');
    assert.deepEqual(new Set(deletions.slice(1).flat()),new Set(poolEvents.map(e=>e.seq)));
    assert.equal(activityEvents.length,92);
    assert.ok(activityEvents.every(e=>e.domain_name==='system'));
    assert.ok(deletions.every(batch=>batch.length<=128));
    // Failed background persistence is never shown as success or automatically retried.
    await page.locator('[data-activity-filter="system"]').click();
    await page.locator('.activity-row-selection[data-sequence="1"]').check();
    deleteFailure=true;const before=deletions.length;
    await page.locator('#activityPurgeBtn').click();
    await page.locator('#activityDeleteConfirmBtn').click();
    await page.waitForFunction(()=>document.getElementById('activityLogStatus').textContent.includes('suppression peut être partielle'));
    assert.equal(deletions.length,before+1);
    assert.ok(activityEvents.some(e=>e.seq===1));
    deleteUnavailable=true;deleteFailure=false;
    const beforeUnavailable=deletions.length;
    await page.locator('.activity-row-selection[data-sequence="1"]').check();
    await page.locator('#activityPurgeBtn').click();
    await page.locator('#activityDeleteConfirmBtn').click();
    await page.waitForFunction(()=>document.getElementById('activityLogStatus').textContent.includes('Suppression impossible'));
    await page.waitForTimeout(1500);
    assert.equal(deletions.length,beforeUnavailable+1);
    assert.deepEqual(errors,[]);
    console.log('Activity: all filtered dates/pages, async confirmation, cancellation, failure, no unrelated deletion or retry passed');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
