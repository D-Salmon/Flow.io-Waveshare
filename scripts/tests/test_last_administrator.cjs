const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless: true, executablePath: process.env.FLOWIO_TEST_BROWSER});
 try {
  const page = await browser.newPage();
  await page.setContent('<div id="usersList"></div><div id="usersListStatus"></div>');
  const source = fs.readFileSync(path.resolve(__dirname, '../../data/webinterface/app.js'), 'utf8');
  const fragment = source.slice(source.indexOf('    async function refreshUsersList()'), source.indexOf('    function openUserForm('));
  await page.addScriptTag({content: `const tr = (key, fallback) => fallback;
   const normalizeRole = raw => String(raw || '').trim().toLowerCase();
   const roleLabel = role => role;
   const usersListEl = () => document.getElementById('usersList');
   const usersListStatusEl = () => document.getElementById('usersListStatus');
   const fetchWithBusyRetry = async () => ({ok:true,json:async () => ({ok:true,accounts:window.accounts})});
   const openUserForm = () => {}; const deleteUser = () => {};
   ${fragment}
   window.refreshUsersList = refreshUsersList;`});
  for (const [accounts, deletable] of [
   [[{username:'admin',role:'admin'}], []],
   [[{username:'admin',role:'admin'},{username:'operator',role:'operator'}], ['operator']],
   [[{username:'admin',role:'admin'},{username:'second',role:'admin'}], ['admin','second']]
  ]) {
   await page.evaluate(async accounts => {window.accounts=accounts;await window.refreshUsersList();}, accounts);
   const actual = await page.locator('.users-row').evaluateAll(rows => rows.filter(row => row.querySelector('.danger-action')).map(row => row.querySelector('.users-username').textContent));
   assert.deepEqual(actual,deletable);
   assert.equal(await page.getByRole('button',{name:'Modifier'}).count(),accounts.length);
  }
  console.log('Last administrator: delete hidden; operators and multiple administrators remain deletable; edit preserved.');
 } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
