const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp'),'utf8');
const html=source.match(/kWebInterfaceFallbackPage\[\] PROGMEM = R"HTML\(([\s\S]*?)\)HTML";/)[1];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FLOWIO_TEST_BROWSER});
 try {
  const page=await browser.newPage(); let active=false; let failMeta=false;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://flowio.local/api/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/web/meta')return route.fulfill({status:failMeta?500:200,contentType:'application/json',body:JSON.stringify(failMeta?{ok:false,err:{code:'Failed'}}:{ok:true,physical_recovery_active:active,physical_recovery_remaining_s:299,auth_enabled:false,admin_authenticated:false,csrf_token:'1234567890abcdef1234567890abcdef',extra:'x'.repeat(1500)})});
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,active,remaining_s:299})});
  });
  await page.setContent(html.replace('<head>','<head><base href="http://flowio.local/">'));
  await page.getByText('Aucun administrateur. Maintenez BOOT 5 secondes pour lancer la configuration initiale.',{exact:true}).waitFor();
  assert(await page.locator('#adminPass').isDisabled());
  active=true;
  await page.waitForFunction(()=>document.querySelector('#securityMsg').textContent.includes('Recuperation BOOT active'));
  assert(await page.locator('#adminPass').isEnabled());
  assert(await page.locator('#networkSection').isVisible());
  failMeta=true; await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelector('#securityMsg').textContent.includes('Lecture de l\'etat de recuperation impossible'));
  assert.deepEqual(errors,[]);
  console.log('Rescue: BOOT polling, protected initial state, long metadata and visible API failure passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
