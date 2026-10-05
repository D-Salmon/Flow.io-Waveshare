const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');const source=fs.readFileSync(path.join(root,'data/webinterface/app.js'),'utf8');
const dictionaries=['fr','en'].map(locale=>JSON.parse(fs.readFileSync(path.join(root,`data/webinterface/i18n/${locale}.json`),'utf8')).translations);
for(const [locale,translations] of dictionaries.entries()){
 const context={tr:(key,fallback)=>translations[key]||fallback};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    function ioSummaryText('),source.indexOf('    function ioSummaryIoIdLabel(')),context);
 assert.equal(context.ioSummaryLocalizedName('Custom name'),'Custom name');
 if(locale===0){
  assert.equal(context.ioSummaryLocalizedName('Water Temperature'),'Température de l’eau');
  assert.equal(context.ioSummaryLocalizedName('Filtration Pump'),'Pompe de filtration');
  assert.equal(context.ioSummaryLocalizedName('PSI'),'Pression');
  assert.equal(context.ioSummarySlotLabel({io_slot:'digital_out',io_slot_index:2}),'Sortie numérique #2');
  assert.equal(context.ioSummaryErrorLabel('no_valid_value'),'Aucune mesure valide');
  assert.equal(context.ioSummaryValueLabel({last_value:'off'}),'Arrêt');
  assert.equal(translations['io.table.domainSlots'],'Fonctions et équipements');
 }else assert.equal(context.ioSummaryLocalizedName('Water Temperature'),'Water Temperature');
}
console.log('I/O French names, slot types, errors, states and headings translated; custom names and English fallback preserved.');
