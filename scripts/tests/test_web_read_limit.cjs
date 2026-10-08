const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('data/webinterface/app.js', 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const releases = [];
const started = [];
const cache = {};
let automatic = false, active = 0, maximum = 0;
const context = vm.createContext({
  URLSearchParams,
  tr: (key, fallback) => fallback,
  nettoyerNomFlowCfg: value => value,
  flowCfgBatchSize: 8,
  poolLogicDeviceIoOutputNames: cache,
  poolLogicDeviceIoOutputModule: slot => 'output' + slot,
  poolLogicDeviceIoOutputNameKey: slot => 'name' + slot,
  fetchWithBusyRetry: async (url, options) => {
    started.push(url);
    if (url === 'network-error') throw new Error('offline');
    active++;
    maximum = Math.max(maximum, active);
    return { ok: true, json: async () => {
      if (automatic || options?.method === 'POST') await turn();
      else await new Promise(resolve => releases.push(resolve));
      active--;
      if (url === 'invalid-json') throw new Error('invalid JSON');
      if (url.startsWith('/api/flowcfg/batch?')) {
        const names = JSON.parse(new URLSearchParams(url.split('?')[1]).get('names'));
        return {ok: true, modules: Object.fromEntries(names.map(name => {
          const slot = Number(name.slice('output'.length));
          return [name, {['name' + slot]: ' Output ' + slot + ' '}];
        }))};
      }
      const slot = Number(url.split('output')[1]);
      return { ok: true, data: { ['name' + slot]: ' Output ' + slot + ' ' } };
    } };
  }
});
vm.runInContext(source.slice(source.indexOf('    function createRequestLimiter('),
  source.indexOf('    function extractApiErrorMessage(')), context);
vm.runInContext(source.slice(source.indexOf('    async function loadPoolLogicDeviceSlotLabels('),
  source.indexOf('    function closeColorPickerPopover(')), context);
function extract(name) {
  const start = source.search(new RegExp('^    (?:async )?function ' + name + '\\(', 'm'));
  const end = source.slice(start + 1).search(/^    (?:async )?function /m);
  assert(start >= 0 && end >= 0, name);
  return source.slice(start, start + 1 + end);
}
vm.runInContext(['extractApiErrorMessage', 'ensureOkJsonResponse', 'fetchOkJson', 'fetchFlowCfgModules']
  .map(extract).join('\n'), context);
(async () => {
  const reads = [0, 1, 2].map(i => context.fetchJsonResponse('read' + i));
  await turn();
  assert.equal(started.length, 2); // Headers alone do not free admission.
  await context.fetchJsonResponse('write', { method: 'POST' });
  assert.equal(started.length, 3); // Writes do not wait behind background reads.
  releases.shift()();
  await turn();
  assert.equal(started.at(-1), 'read2');
  releases.splice(0).forEach(release => release());
  await Promise.all(reads);
  await turn();
  automatic = true;
  const outcomes = await Promise.allSettled([
    context.fetchJsonResponse('network-error'),
    context.fetchJsonResponse('invalid-json'),
    context.fetchJsonResponse('after-error')
  ]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(outcomes[1].value.data, null);
  assert.equal(outcomes[2].status, 'fulfilled');
  await turn();
  maximum = 0;
  const before = started.length;
  await Promise.all([
    context.loadPoolLogicDeviceSlotLabels(false),
    context.fetchJsonResponse('documentation')
  ]);
  assert.equal(maximum, 2); // Both label batches share admission with other JSON reads.
  assert.equal(started.length - before, 3);
  for (let slot = 0; slot < 16; slot++) assert.equal(cache[slot], 'Output ' + slot);
  const cached = started.length;
  await context.loadPoolLogicDeviceSlotLabels(false);
  assert.equal(started.length, cached);
  await context.loadPoolLogicDeviceSlotLabels(true);
  assert.equal(started.length, cached + 2);
  console.log('JSON reads: shared limit=2 through body reception, writes bypass, error recovery, 16 labels in two batches, cache and forced reload OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
