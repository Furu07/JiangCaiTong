const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../web/zhuli.js'), 'utf8'), context);
const { create } = context.window.Zhuli;

test('selects the store or installed app without creating a local authorization', () => {
  let installed = false;
  let launches = 0;
  const service = create({
    zhuliAppAvailable: () => installed,
    openOfficialZhuli: () => { launches++; }
  });

  assert.equal(service.status(), 'external-store');
  assert.equal(launches, 0);
  assert.equal(service.open(), true);
  assert.equal(launches, 1);
  installed = true;
  assert.equal(service.status(), 'external-app');
  assert.equal(launches, 1);
});

test('handles a missing or failing Android bridge independently of other services', () => {
  const missing = create({ openOfficialWater: () => assert.fail('must not call the water service') });
  assert.equal(missing.status(), 'unavailable');
  assert.equal(missing.open(), false);

  const broken = create({
    zhuliAppAvailable() { throw new Error('unavailable'); },
    openOfficialZhuli() { throw new Error('unavailable'); }
  });
  assert.equal(broken.status(), 'unavailable');
  assert.equal(broken.open(), false);
});
