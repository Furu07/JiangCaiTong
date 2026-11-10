const test = require('node:test');
const assert = require('node:assert/strict');
const Todo = require('../web/todo.js');
const Records = require('../web/academic-records.js');

test('todos persist across reopen, keep completion on edit, and survive a failed write', () => {
  const values = new Map();
  let failWrite = false;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (failWrite) throw new Error('write failure');
      values.set(key, value);
    }
  };
  let now = 1;
  const store = Todo.create(storage, () => now++);
  assert.throws(() => store.add({ title: '   ' }));
  assert.throws(() => store.add({ title: 'Sample', dueAt: '2026-02-30' }));
  store.add({ title: ' Sample ' });
  const [{ id }] = store.list();
  store.add({ title: 'Second' });
  assert.notEqual(store.list()[0].id, id);
  store.toggle(id);
  store.edit(id, { title: 'Edited', description: 'Notes', dueAt: '2026-11-20' });
  const completed = store.list().find(row => row.id === id);
  assert.deepEqual(completed, { id, title: 'Edited', description: 'Notes', dueAt: '2026-11-20',
    completed: true, createdAt: 1 + 2, updatedAt: 6, completedAt: 5 });
  failWrite = true;
  assert.throws(() => store.remove(id), /保存失败/);
  assert.deepEqual(Todo.create(storage).list(), store.list());
  failWrite = false;
  store.toggle(id);
  assert.equal(store.list().find(row => row.id === id).completedAt, null);
  store.remove(id);
  assert.equal(Todo.create(storage).list().length, 1);
  storage.setItem(Todo.key, 'invalid');
  const broken = Todo.create(storage);
  assert.ok(broken.error);
  assert.throws(() => broken.add({ title: 'Sample' }));
  assert.equal(storage.getItem(Todo.key), 'invalid');
});

test('academic records distinguish unpublished, empty and failed queries', async () => {
  const scope = { accountKey: 'fixture', state: 'authorized' };
  const exams = Records.exams(async (accountKey, termId) => ({
    accountKey, termId, state: termId === '261' ? 'unpublished' : 'empty', rows: []
  }));
  assert.equal((await exams.load(scope, '261')).state, 'unpublished');
  assert.equal((await exams.load(scope, '252')).state, 'empty');
  const valid = Records.exams(async (accountKey, termId) => ({
    accountKey, termId, state: 'ready', rows: [{ name: 'Sample', date: '2026-11-15',
      start: '09:00', end: '11:00', campus: 'Sample campus', seat: 4 }]
  }));
  assert.equal((await valid.load(scope, '261')).rows[0].seat, '4');
  const invalid = Records.exams(async (accountKey, termId) => ({
    accountKey, termId, state: 'ready', rows: [{ name: 'Sample', date: '2026-02-31' }]
  }));
  assert.equal((await invalid.load(scope, '261')).state, 'format');
  assert.equal((await Records.grades().load(scope, '261')).state, 'unavailable');
});

test('grades keep the same account and term on network failure and reject stale results', async () => {
  const accountA = { accountKey: 'A', state: 'authorized' };
  const accountB = { accountKey: 'B', state: 'authorized' };
  let source = async (accountKey, termId) => ({
    accountKey, termId, state: 'ready', rows: [{ name: 'Sample', credits: 0, grade: 0 }]
  });
  const grades = Records.grades((...args) => source(...args));
  assert.equal((await grades.load(accountA, '261')).rows[0].grade, '0');
  source = async () => { throw { code: 'network' }; };
  assert.equal((await grades.load(accountA, '261', true)).cached.rows.length, 1);
  assert.equal((await grades.load(accountA, '252', true)).cached, undefined);
  assert.equal((await grades.load(accountB, '261')).cached, undefined);

  let finish;
  source = (accountKey, termId) => new Promise(resolve => {
    finish = () => resolve({ accountKey, termId, state: 'empty', rows: [] });
  });
  const pending = grades.load(accountB, '261');
  await Promise.resolve();
  assert.equal((await grades.load({ ...accountB, state: 'reauthorize' }, '261')).state, 'expired');
  finish();
  assert.equal((await pending).state, 'account-changed');
});
