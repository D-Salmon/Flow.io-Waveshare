const os = require('node:os');
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { project, loadDialog, installDialog } = require('./runtime_action_dialog_test_support.cjs');
const entry = loadDialog('PoolDeviceModule', 5, 2305);
const config = entry.displayConfig.actionDialog;
const commands = [];
const slot = Number(process.env.FLOWIO_TEST_OVERRIDE_SLOT || 0);
const name = slot === 0 ? 'Filtration' : 'Éclairage';
const label = `${name} (pd${slot})`;
const automatic = slot === 0;
const device = { value: slot, label, name, deviceId: `pd${slot}`,
  actualOn: false, controllable: true, override_supported: true, override_available: true,
  control_mode: 'guided', control_automatic: automatic, override_remaining_s: 0, override_value: null,
  running: { day_s: 0, week_s: 0, month_s: 0, total_s: 0 },
  injected: { day_ml: 0, week_ml: 0, month_ml: 0, total_ml: 0 } };
let failCommand = false;
const server = http.createServer((request, response) => {
  if (request.url === config.optionsUrl) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ options: [device] }));
  } else if (request.url === '/api/runtime/action') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const command = Object.fromEntries(new URLSearchParams(body)); commands.push(command);
      if (!failCommand) {
        if (command.action_id === 'release_override') {
          device.control_mode = 'guided'; device.override_remaining_s = 0;
          device.override_value = null;
        } else {
          device.control_mode = 'forced'; device.override_remaining_s = Number(command.input);
          device.override_value = command.action_id === 'override_on';
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(failCommand ? { ok: false, error: 'Sauvegarde impossible' } : { ok: true }));
    });
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html lang="fr"><head><meta charset="utf-8"></head><body><div class="status-card"><h3>Équipements</h3></div></body></html>');
  }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? { executablePath: process.env.FLOWIO_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addStyleTag({ content: fs.readFileSync(path.join(project, 'data/webinterface/app-core.css'), 'utf8') });
    await page.evaluate(() => {
      window.testState = { invalidations: 0, refreshes: [] };
      window.fetchOkJson = async url => (await fetch(url)).json();
      window.fetchWithBusyRetry = (url, request) => fetch(url, request);
    });
    await installDialog(page, entry);
    await page.getByRole('button', { name: config.buttonText, exact: true }).click();
    const open = page.getByRole('button', { name: `Forcer… — ${label}`, exact: true });
    const modify = page.getByRole('button', { name: `Modifier… — ${label}`, exact: true });
    const panel = page.locator('.runtime-override-panel');
    const apply = panel.locator('button.primary');
    const release = page.getByRole('button', { name: 'Terminer le forçage', exact: true });
    const duration = page.getByRole('spinbutton', { name: `Durée (minutes) — ${label}`, exact: true });
    await open.waitFor();
    assert.equal(await panel.count(), 0);
    assert(await page.locator('.runtime-override-status').isHidden(), 'Normal control needs no badge');
    assert.equal(await page.getByRole('switch').count(), 1, 'Each equipment keeps its existing toggle alongside temporary control');
    assert.equal(await open.evaluate(node => node.closest('td') === node.closest('tr').lastElementChild), true, 'Force and reset share the actions column');
    assert.equal(await page.locator('thead th').count(), 7);
    assert.equal(await page.locator('.runtime-action-switch-control > span').evaluate(node => getComputedStyle(node).position), 'absolute', 'On/Off is not visible beside the toggle');
    await open.click();
    assert(await release.isHidden());
    await page.getByRole('button', { name: '15 min', exact: true }).click();
    await apply.click();
    await page.waitForFunction(() => document.querySelector('.runtime-override-status').textContent.includes('15:00'));
    assert.equal(await panel.count(), 0);
    assert.deepEqual(commands.at(-1), { runtime_id: '2305', action_id: 'override_on', input: '900', target: String(slot) });
    assert.equal(device.actualOn, false, 'Acceptance does not pretend that hardware is running');
    await modify.click();
    await page.getByRole('button', { name: 'Autre', exact: true }).click();
    await duration.fill('20');
    await page.evaluate(() => runtimeActionDialogRefresh.refresh());
    assert.equal(await duration.inputValue(), '20', 'Live updates preserve the draft');
    assert(await duration.evaluate(node => node === document.activeElement));
    assert.equal(await panel.count(), 1);
    await page.getByRole('button', { name: 'Arrêt', exact: true }).click();
    await duration.fill('0'); await apply.click();
    assert.equal(commands.length, 1, 'An invalid duration never reaches the server');
    await duration.fill('20'); await apply.click();
    await page.waitForFunction(() => document.querySelector('.runtime-override-status').textContent.includes('Arrêt forcé'));
    assert.equal(commands.at(-1).input, '1200');
    await modify.click(); await release.click();
    await open.waitFor();
    assert(await page.locator('.runtime-override-status').isHidden());
    assert.deepEqual(commands.at(-1), { runtime_id: '2305', action_id: 'release_override', target: String(slot) });
    await open.click(); await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    assert(await open.evaluate(node => node === document.activeElement));
    failCommand = true; await open.click(); await apply.click();
    await page.waitForFunction(() => document.querySelector('dialog .runtime-action-dialog-feedback').textContent.includes('Sauvegarde impossible'));
    assert.equal(device.control_mode, 'guided');
    assert.equal(await panel.count(), 1, 'A rejected command preserves the editor');
    failCommand = false;
    device.control_mode = 'waiting_time'; device.override_available = false; device.override_remaining_s = null;
    await page.evaluate(() => runtimeActionDialogRefresh.refresh());
    assert.match(await page.locator('.runtime-override-status').textContent(), /attente de l’heure/);
    assert(await apply.isDisabled()); assert(await release.isEnabled());
    device.control_mode = 'forced'; device.override_available = true; device.override_remaining_s = 1200;
    device.override_value = false;
    await page.evaluate(() => runtimeActionDialogRefresh.refresh());
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await modify.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(os.tmpdir(), 'flow-timed-override-dialog.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const panelBox = await panel.boundingBox();
    assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, 'The entire override panel fits on mobile');
    await page.screenshot({ path: path.join(os.tmpdir(), 'flow-timed-override-dialog-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`Timed override web commands on pd${slot} (automatic=${automatic}), validation, pending time and durable failure: OK`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
