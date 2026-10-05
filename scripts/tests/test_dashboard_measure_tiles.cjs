const os = require('node:os');
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(project, 'data/webinterface/app.js'), 'utf8');
const sinceCode = app.slice(
  app.indexOf('    function formatStateDurationMs('),
  app.indexOf('    function formatRuntimeDurationMs(')
);
const floatCode = app.slice(
  app.indexOf('    function formatRuntimeFloatValue('),
  app.indexOf('    function formatRuntimeMeasureValue(')
);
const sensorCode = app.slice(
  app.indexOf('    function poolSondeRangeFromEntry('),
  app.indexOf('    function runtimeMeasureResolvedLabel(')
);
const alarmCode = app.slice(
  app.indexOf('    function decorateDashboardAlarmTile('),
  app.indexOf('    function buildRuntimeAlarmGrid(')
);
const alarmSlotsCode = app.slice(app.indexOf('    function poolAlarmLabel('), app.indexOf('    function runtimeMeasureDisplayLabel('))
  + app.slice(app.indexOf('    function buildPoolAlarmSlotsGrid('), app.indexOf('    function buildRuntimeMeasureFlagsTable('));

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FLOWIO_TEST_BROWSER ? { executablePath: process.env.FLOWIO_TEST_BROWSER } : {})
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.setContent('<html lang="fr"><body><main></main></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(project, 'data/webinterface/app-core.css'), 'utf8') });
    await page.evaluate(({ sinceCode, floatCode, sensorCode, alarmCode, alarmSlotsCode }) => {
      window.runtimeMeasureDisplayConfig = entry => entry && entry.displayConfig ? entry.displayConfig : {};
      window.tr = (_key, fallback) => fallback;
      const script = document.createElement('script');
      script.textContent = sinceCode + '\n' + floatCode + '\n' + sensorCode + '\n' + alarmCode + '\n' + alarmSlotsCode + `
        const entries = [
          {id:2201,displayConfig:{bands:{min:0,max:40}}},
          {id:2203,displayConfig:{bands:{min:6.4,max:8.4}}},
          {id:2204,displayConfig:{bands:{min:350,max:900}}}
        ];
        const slots = enrichPoolSondeSlotsWithRanges([
          {slot:0,runtimeUiId:2201,label:'Température eau',value:'24',unit:'°C',enabled:true,available:true,bgColor:'#E6EFFF'},
          {slot:1,runtimeUiId:2203,label:'pH',value:'7.2',unit:'',enabled:true,available:true,bgColor:'#E8FAEF'},
          {slot:2,runtimeUiId:2204,label:'ORP',value:'700',unit:'mV',enabled:true,available:true,bgColor:'#F0EAFE'},
          {slot:3,runtimeUiId:2205,label:"Volume d'eau",value:'128',unit:'L',enabled:true,available:true,bgColor:'#FFFFFF'}
        ], entries);
        const sensorCard = document.createElement('section');
        sensorCard.className = 'status-card'; sensorCard.innerHTML = '<h3>Sondes</h3>';
        sensorCard.appendChild(buildPoolSondeSlotsGrid(slots)); document.querySelector('main').appendChild(sensorCard);
        const alarmCard = document.createElement('section');
        alarmCard.className = 'status-card'; alarmCard.innerHTML = '<h3>Alarmes</h3>';
        const alarmGrid = document.createElement('div'); alarmGrid.className = 'status-alarm-slot-grid';
        alarmGrid.appendChild(buildDashboardAlarmTile({label:'Pression basse',conditionValue:false,latchValue:false,sinceMs:3*3600000+12*60000}));
        alarmGrid.appendChild(buildDashboardAlarmTile({label:'Cuve pH',conditionValue:true,latchValue:true}));
        alarmGrid.appendChild(buildDashboardAlarmTile({label:'Durée pompe',conditionValue:false,latchValue:true}));
        alarmCard.appendChild(alarmGrid); document.querySelector('main').appendChild(alarmCard);`;
      document.body.appendChild(script);
    }, { sinceCode, floatCode, sensorCode, alarmCode, alarmSlotsCode });

    assert.equal(await page.locator('.status-sonde-slot').count(), 4, 'Only enabled probes appear');
    assert.equal(await page.locator('.status-sonde-slot-range').count(), 3, 'Only configured credible ranges render bars');
    assert.equal(await page.locator('.status-sonde-slot-range[aria-label="pH"]').getAttribute('aria-valuemin'), '6.4');
    assert.deepEqual(await page.locator('.status-sonde-slot-range-label').allTextContents(),
      ['plage 0–40 °C', 'plage 6.4–8.4', 'plage 350–900 mV']);
    assert.deepEqual(await page.locator('.status-alarm-slot-value').allTextContents(), ['Normal', 'Alarme active', 'À acquitter']);
    assert.deepEqual(await page.locator('.status-alarm-slot-since').allTextContents(), ['depuis 3h 12mn']);
    const desktopColumns = await page.locator('.status-sonde-slot-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    assert.equal(desktopColumns, 2, 'Desktop measurement cards retain the larger requested display');
    await page.screenshot({ animations: 'disabled', path: path.join(os.tmpdir(), 'flowio-dashboard-measure-tiles.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileColumns = await page.locator('.status-sonde-slot-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    assert.equal(mobileColumns, 1, 'The larger tiles remain readable on mobile');
    assert(await page.locator('body').evaluate(element => element.scrollWidth <= 390));
    await page.evaluate(async () => {
      window.fetchPoolDashboardSlots = async () => ({ alarm_slots: Array.from({length:9}, (_,slot) => ({
        slot,alarm_id:slot===8?1010:slot===4?1004:slot===5?1005:1100+slot,
        enabled:true,available:true,condition_known:true,condition_true:false,
        label:slot===4?'pH uptime':slot===5?'ORP uptime':'Autre alarme'
      })) });
      const slots = await fetchPoolAlarmSlots();
      document.querySelector('main').replaceChildren(buildPoolAlarmSlotsGrid(slots));
    });
    assert.equal(await page.locator('.status-alarm-slot').count(),9,'The flow alarm is retained after eight configured slots');
    assert(await page.getByText('Durée maximale pompe pH',{exact:true}).isVisible());
    assert(await page.getByText('Durée maximale pompe chlore',{exact:true}).isVisible());
    assert(await page.getByText('Débit de filtration absent',{exact:true}).isVisible());
    await page.evaluate(() => document.querySelector('main').replaceChildren(buildPoolAlarmSlotsGrid([
      {slot:8,enabled:false,label:'Débit de filtration absent'}
    ])));
    assert.equal(await page.locator('.status-alarm-slot').count(),0,'Disabled flow monitoring has no alarm card');
    console.log('Dashboard measure tiles: ranges, alarm states and responsive grids passed');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
