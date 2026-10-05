const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const project = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(project, 'src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp'), 'utf8');
const match = source.match(/static const char kLoginPageHtml\[\] PROGMEM = R"HTML\(([\s\S]*?)\)HTML";/);
assert(match);
async function main() {
 const browser = await chromium.launch({headless:true, ...(process.env.FLOWIO_TEST_BROWSER ? {executablePath:process.env.FLOWIO_TEST_BROWSER}: {})});
 try {
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  let localOperator=false;
  await page.route('http://flowio.local/api/auth/session', route=>route.fulfill({contentType:'application/json',body:JSON.stringify({local_operator:localOperator})}));
  await page.route('http://flowio.local/api/auth/login', route=>{
   const values=new URLSearchParams(route.request().postData());
   assert.equal(values.get('username'),'admin'); assert.equal(values.get('password'),'wrong-password');
   return route.fulfill({status:401,contentType:'application/json',body:'{"ok":false}'});
  });
  const html=match[1].replace('<head>','<head><base href="http://flowio.local/">');
  for (const width of [1440,390]) {
   await page.goto("about:blank"); await page.setViewportSize({width,height:960}); await page.setContent(html);
   await page.waitForFunction(()=>document.querySelector('#local').hidden);
   assert.equal(await page.locator('#p').getAttribute('type'),'password');
   assert(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));
   await page.locator('#u').fill('admin'); await page.locator('#p').fill('wrong-password');
   await page.locator('button').click();
   await page.getByText('Identifiant ou mot de passe incorrect.',{exact:true}).waitFor();
  }
  localOperator=true; await page.goto("about:blank"); await page.setContent(html); await page.locator('#local').waitFor({state:'visible'});
  assert.equal(await page.locator('#local').getAttribute('href'),'/webinterface'); assert.deepEqual(errors,[]);
  console.log('Login: rejected credentials, protected password, local operator access and responsive layout passed');
 } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
