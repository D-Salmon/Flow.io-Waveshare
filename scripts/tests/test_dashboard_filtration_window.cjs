'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../../data/webinterface/app.js'), 'utf8');
const start = app.indexOf('    function dashboardFiltrationWindow(');
const end = app.indexOf('    function renderDashboardFiltrationTimeline(', start);
assert(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(app.slice(start, end), context);
const window = (a, b) => JSON.parse(JSON.stringify(context.dashboardFiltrationWindow(a, b)));
assert.deepEqual(window(11,18), {minutes:420,spans:[{start:660,minutes:420}]});
assert.deepEqual(window(22,2), {minutes:240,spans:[{start:1320,minutes:120},{start:0,minutes:120}]});
assert.deepEqual(window(22,0), {minutes:120,spans:[{start:1320,minutes:120}]});
assert.deepEqual(window(22,24), window(22,0));
assert.deepEqual(window(0,0), {minutes:1440,spans:[{start:0,minutes:1440}]});
assert.deepEqual(window(7,7), {minutes:1440,spans:[{start:420,minutes:1020},{start:0,minutes:420}]});
assert.deepEqual(window(22.5,0.25), {minutes:105,spans:[{start:1350,minutes:90},{start:0,minutes:15}]});
for (const value of [null, undefined, '', ' ', NaN, Infinity, -1, 25, 'bad']) {
  assert.deepEqual(window(value,18), {minutes:null,spans:[]});
  assert.deepEqual(window(11,value), {minutes:null,spans:[]});
}
console.log('Filtration timeline: daytime, midnight wrap, full day, fractional hours and invalid values passed.');
