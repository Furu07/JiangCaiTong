const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../web/zhuli-devices.js'), 'utf8'), context);
const { create } = context.window.ZhuliDevices;
const catalog = {
  project: '测试项目',
  devices: [
    { id: 'fixture-a', label: '样本 A', building: '测试楼', floor: '二层', room: '样本房间', availability: 'available' },
    { id: 'fixture-b', label: '样本 B', availability: 'occupied' }
  ]
};
const result = (state, deviceId = 'fixture-a', feeNotice) => ({ deviceId, state, feeNotice });

test('an unconfigured or expired session exposes no devices and performs no operations', async () => {
  const unavailable = create();
  assert.equal(unavailable.snapshot().access, 'unconfigured');
  assert.equal(unavailable.snapshot().devices.length, 0);
  assert.equal(unavailable.refresh(), false);
  assert.equal(unavailable.connect(), false);
  assert.equal(unavailable.start(true), false);

  let account = 'test-session';
  const service = create({ scope: () => account, listDevices: async () => catalog });
  assert.equal(await service.refresh(), true);
  assert.equal(service.select('fixture-a'), true);
  account = '';
  assert.equal(service.snapshot().access, 'needs-auth');
  assert.equal(service.snapshot().selected, null);
  assert.equal(service.snapshot().devices.length, 0);
});

test('only an authorized catalog fills the list and malformed refresh preserves the prior snapshot', async () => {
  let reply = catalog;
  const service = create({ scope: () => 'test-session', listDevices: async () => reply }, () => 1000);
  assert.equal(await service.refresh(), true);
  assert.equal(service.snapshot().refreshedAt, 1000);
  assert.equal(service.snapshot().devices[0].room, '样本房间');
  assert.equal(service.select('fixture-b'), true);
  assert.equal(service.snapshot().can.connect, false);
  reply = { ...catalog, devices: [catalog.devices[0], catalog.devices[0]] };
  assert.equal(await service.refresh(), false);
  assert.equal(service.snapshot().devices.length, 2);
  assert.equal(service.snapshot().selected.id, 'fixture-b');
  assert.equal(service.snapshot().refreshedAt, 1000);
});

test('confirmed replies drive connect, start and stop while preventing duplicate or cross-device actions', async () => {
  let resolveConnect;
  let starts = 0;
  const service = create({
    scope: () => 'test-session', listDevices: async () => catalog,
    connect: () => new Promise(resolve => { resolveConnect = resolve; }),
    readStatus: async () => result('READY'),
    controlsVerified: true,
    start: async () => { starts++; return result('RUNNING'); },
    stop: async () => result('FINISHED')
  });
  await service.refresh();
  assert(service.select('fixture-a'));
  const connection = service.connect();
  assert.equal(service.snapshot().state, 'CONNECTING');
  assert.equal(service.connect(), false);
  assert.equal(service.select('fixture-b'), false);
  resolveConnect(result('READY', 'fixture-a', '测试计费说明'));
  assert.equal(await connection, true);
  assert.equal(service.snapshot().state, 'READY');
  assert.equal(service.start(false), false);
  assert.equal(starts, 0);
  const starting = service.start(true);
  assert.equal(service.snapshot().state, 'STARTING');
  assert.equal(service.start(true), false);
  assert.equal(await starting, true);
  assert.equal(service.snapshot().state, 'RUNNING');
  const stopping = service.stop();
  assert.equal(service.snapshot().state, 'STOPPING');
  assert.equal(await stopping, true);
  assert.equal(service.snapshot().state, 'FINISHED');
  assert.equal(starts, 1);
});

test('ambiguous outcomes block retry and switching until an authoritative status check', async () => {
  let stopCalls = 0;
  let check = result('RUNNING', 'fixture-b');
  const service = create({
    scope: () => 'test-session', listDevices: async () => catalog,
    connect: async () => result('READY', 'fixture-a', '测试计费说明'),
    controlsVerified: true, start: async () => result('RUNNING'),
    stop: async () => { stopCalls++; throw new Error('timeout'); },
    readStatus: async () => check
  });
  await service.refresh();
  service.select('fixture-a');
  await service.connect();
  await service.start(true);
  assert.equal(await service.stop(), false);
  assert.equal(service.snapshot().state, 'UNKNOWN');
  assert.equal(service.stop(), false);
  assert.equal(service.select('fixture-b'), false);
  assert.equal(stopCalls, 1);
  assert.equal(await service.check(), false);
  assert.equal(service.snapshot().state, 'UNKNOWN');
  check = result('ERROR');
  assert.equal(await service.check(), false);
  assert.equal(service.snapshot().state, 'ERROR');
  check = result('FINISHED');
  assert.equal(await service.check(), true);
  assert.equal(service.snapshot().state, 'FINISHED');
  assert.equal(service.select('fixture-b'), true);
});

test('changing accounts discards late replies and blocks a second operation while the first is pending', async () => {
  let owner = 'first-session';
  let resolveList;
  const service = create({
    scope: () => owner,
    listDevices: scope => scope === 'first-session'
      ? new Promise(resolve => { resolveList = resolve; }) : Promise.resolve({ project: '另一个项目', devices: [] })
  });
  const first = service.refresh();
  owner = 'second-session';
  assert.equal(service.snapshot().devices.length, 0);
  assert.equal(service.refresh(), false);
  resolveList(catalog);
  assert.equal(await first, false);
  assert.equal(await service.refresh(), true);
  assert.equal(service.snapshot().project, '另一个项目');
  assert.equal(service.select('fixture-a'), false);
});
