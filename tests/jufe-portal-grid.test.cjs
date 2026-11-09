const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
context.window = context;
for (const file of ['academic.js', 'jufe-academic.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web', file), 'utf8'), context);
}

const adapter = context.JufeAcademicAdapter;
const term = { id: 'fixture', label: '脱敏示例学期', firstMonday: '2026-09-07', totalWeeks: 20 };
const parse = (blocks, termMetadata = term) => adapter.parseSchedule({
  format: 'jufe-portal-grid', content: JSON.stringify({ term: termMetadata, blocks })
}, adapter.schoolParsers);
const blocks = [
  { weekday: '星期一', text: '示例课程\n示例教师\n1-15[3-4]\n示例楼 301(示例校区)' },
  { weekday: '星期日', text: '示例课程\r\n示例教师\r\n2-8双,11[5]\r\n另一地点' }
];
const schedule = parse(blocks);
assert.equal(schedule.termId, 'fixture');
assert.equal(schedule.courses.length, 2);
const [first, second] = schedule.courses;
assert.notEqual(first.id, second.id);
assert.equal(first.day, 1);
assert.equal(first.startPeriod, 3);
assert.equal(first.endPeriod, 4);
assert.equal(first.weeks.at(-1), 15);
assert.equal(first.location, '示例楼 301');
assert.equal(first.campus, '示例校区');
assert.equal(second.day, 7);
assert.equal(second.startPeriod, second.endPeriod);
assert.equal(JSON.stringify(second.weeks), '[2,4,6,8,11]');

const isFormatError = error => error.code === 'format';
assert.throws(() => parse([]), isFormatError);
assert.throws(() => parse(blocks, { ...term, firstMonday: undefined }), isFormatError);
assert.throws(() => parse([{ ...blocks[0], weekday: '未知日期' }]), isFormatError);
assert.throws(() => parse([{ ...blocks[0], text: blocks[0].text + '\n调整标记' }]), isFormatError);
assert.throws(() => parse([{ ...blocks[0], text: blocks[0].text.replace('[3-4]', '[4-3]') }]), isFormatError);
assert.equal(adapter.schoolTransport, null);
console.log('PASS JUFE portal grid projection, period/week distinction, campus, and unverified input rejection');
