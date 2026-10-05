const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../data');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.FLOWIO_TEST_BROWSER});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://flowio.local/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname==='/api/web/meta'?{ok:true,web_asset_version:'regression',auth_enabled:true,auth_required:false}:url.pathname==='/api/auth/session'?{ok:true,local_operator:true,admin_authenticated:false}:{ok:true})});
   const name=url.pathname==='/webinterface'?'/webinterface/index.html':url.pathname;
   const file=path.join(root,name);
   if(!fs.existsSync(file))return route.fulfill({status:404});
   const contentType=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html';
   return route.fulfill({contentType,body:fs.readFileSync(file),headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:"}});
  });
  await page.goto('http://flowio.local/webinterface?full=1&page=page-wifi');
  await page.waitForFunction(()=>window.__FLOW_WEB_APP_READY__===true);
  await page.waitForFunction(()=>document.querySelector('#page-wifi')?.classList.contains('active'));
  assert.equal(await page.evaluate(()=>window.__FLOW_WEB_BOOT_ERROR__),undefined);
  assert(!await page.getByText('Chargement de l\'interface impossible',{exact:false}).count());
  assert.deepEqual(errors,[]);
  console.log('Full UI bootstrap: real index, shell, core and application initialize under production CSP');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
