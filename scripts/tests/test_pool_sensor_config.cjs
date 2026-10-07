'use strict';
// Exercise the production renderer with the generated Waveshare metadata.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'data/webinterface/app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const end = app.slice(start + 1).search(/^    (?:async )?function /m);
  assert(end >= 0, name);
  return app.slice(start, start + 1 + end);
}
const functions = ['renderConfigFields','configEnumOptionsForField','buildConfigFieldLabel','configNumericKind',
  'storeConfigFieldInitialValue','readConfigFieldValue','configFieldIsDirty','setConfigFieldValidationState',
  'validateConfigFieldValue','readConfigFieldValueStrict','updatePrimaryCfgApplyState','buildPatchJsonFromFields',
  'configIsBindingPortField','parseConfigNumericValue','parseConfigNumericValueDetailed',
  'formatConfigValueForDisplay','configNumericConstraint','configFieldNormalizedInitialValue'].map(extract).join('\n');
const docs = JSON.parse(fs.readFileSync(path.join(root,'data/webinterface/cfgdocs.json'))).docs;
const enums = JSON.parse(fs.readFileSync(path.join(root,'data/webinterface/cfgmods.json'))).meta.enum_sets;
for (const doc of Object.values(docs)) if (doc.enum_set) doc._enumOptions = enums[doc.enum_set];
const sensors = {wat_temp_io_id:196,air_temp_io_id:197,ph_io_id:193,dis_io_id:192,psi_io_id:194,
  pool_lvl_io_id:65535,ph_lvl_io_id:65535,chl_lvl_io_id:65535,flow_switch_io_id:64,flow_switch_enabled:true,
  filtr_fb_io_id:65535,filtr_fb_active_high:true,swg_fb_io_id:65535,swg_fb_active_high:true,psi_monitoring:true};

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.FLOWIO_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="fields"></main><button id="apply">Appliquer</button>');
    await page.evaluate(({functions,docs,sensors}) => {
      window.flowCfgFields = document.querySelector('#fields'); window.flowCfgApplyBtn = document.querySelector('#apply');
      window.saves = []; window.tr = (key,fallback) => fallback;
      window.configDocFor = (name,key) => docs[name+'/'+key];
      window.closeColorPickerPopover = window.closeDependencyMaskPopover = () => {};
      window.isWaveshareProfile = window.isDigitalInputConfigModule = () => false;
      window.normalizeDigitalInputConfigKey = () => '';
      window.nettoyerNomFlowCfg = name => name;
      window.cfgDocPathCandidates = name => [name];
      window.buildFlowSwitch = ({checked,label}) => {
        const element = document.createElement('label'), input = document.createElement('input');
        input.type='checkbox'; input.checked=checked; input.setAttribute('aria-label',label); element.append(input);
        return {element,input};
      };
      eval(functions + `
        window.build = (name,data) => renderConfigFields(flowCfgFields,name,data,{controlsPrimaryPane:true});
        window.patch = name => JSON.parse(buildPatchJsonFromFields(flowCfgFields,name));
        flowCfgApplyBtn.onclick = () => saves.push(patch('poollogic/sensors'));
        build('poollogic/sensors',sensors);
      `);
    },{functions,docs,sensors});
    const field = key => page.locator('[data-key="'+key+'"]');
    assert.equal(await page.locator('[data-key="psi_monitoring"]').count(),0,'No duplicate pressure toggle');
    for (const key of ['pool_lvl_io_id','ph_lvl_io_id','chl_lvl_io_id','filtr_fb_io_id','swg_fb_io_id']) {
      assert.equal(await field(key).inputValue(),'65535');
      assert.equal(await field(key).locator('option:checked').textContent(),'Désactivé / non câblé');
    }
    assert.equal(await field('filtr_fb_active_high').isVisible(),false);
    assert.equal(await field('swg_fb_active_high').isVisible(),false);
    await field('filtr_fb_io_id').selectOption('65');
    assert.equal(await field('filtr_fb_active_high').isVisible(),true);
    await field('filtr_fb_active_high').selectOption('false');
    await field('swg_fb_io_id').selectOption('66');
    await field('swg_fb_active_high').selectOption('true');
    assert.equal(await page.evaluate(()=>saves.length),0,'Draft edits do not send configuration');
    await page.getByRole('button',{name:'Appliquer'}).click();
    const saved = await page.evaluate(()=>saves.at(-1)['poollogic/sensors']);
    assert.equal(saved.filtr_fb_active_high,false);
    assert.equal(saved.swg_fb_active_high,true,'Boolean selects must preserve true on a whole-branch Apply');
    assert.equal(saved.filtr_fb_io_id,65);
    assert.equal(saved.ph_lvl_io_id,65535);
    await field('filtr_fb_io_id').selectOption('65535');
    await field('flow_switch_io_id').selectOption('65535');
    assert.equal(await field('flow_switch_enabled').isVisible(),false);
    const disabled = await page.evaluate(()=>patch('poollogic/sensors')['poollogic/sensors']);
    assert.equal(Object.hasOwn(disabled,'filtr_fb_active_high'),false,'Hidden polarity is not overwritten');
    assert.equal(Object.hasOwn(disabled,'flow_switch_enabled'),false);
    assert.equal(disabled.flow_switch_io_id,65535);
    await page.evaluate(()=>build('poollogic/pool',{pool_volume_m3:50,indoor:false,automatic_cover:false,cover_closed_at_night:false}));
    assert.equal(await field('pool_volume_m3').inputValue(),'50');
    assert.equal(await field('pool_volume_m3').getAttribute('step'),'0.1');
    await field('pool_volume_m3').fill('65.5');
    const pool = await page.evaluate(()=>patch('poollogic/pool'));
    assert.equal(pool['poollogic/pool'].pool_volume_m3,65.5);
    assert.equal(Object.hasOwn(docs,'poollogic/o2/pool_volume_m3'),false);
    console.log('Pool sensor selectors, conditional fields, explicit Apply and shared volume: passed');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
