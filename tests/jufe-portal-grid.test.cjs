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
const termLabel = '2026-2027学年第一学期';
const parse = (blocks, selected = termLabel) => adapter.parseSchedule({
  format: 'jufe-portal-grid', content: JSON.stringify({ termLabel: selected, blocks })
}, adapter.schoolParsers);
const blocks = [
  { weekday: '星期一', text: '示例课程\n示例教师\n1-15[3-4]\n示例楼 301(示例校区)' },
  { weekday: '星期日', text: '示例课程\r\n示例教师\r\n2-8双,11[5]\r\n另一地点' }
];
const schedule = parse(blocks);
assert.equal(schedule.termId, '261');
assert.equal(schedule.firstMonday, '2026-09-07');
assert.equal(schedule.totalWeeks, 19);
assert.equal(schedule.weekMondays.at(-1), '2027-01-11');
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
assert.throws(() => parse(blocks, '未核实学期'), isFormatError);
assert.throws(() => parse([{ ...blocks[0], text: blocks[0].text.replace('1-15', '1-20') }]), isFormatError);
assert.throws(() => parse([{ ...blocks[0], weekday: '未知日期' }]), isFormatError);
assert.throws(() => parse([{ ...blocks[0], text: blocks[0].text + '\n调整标记' }]), isFormatError);
assert.throws(() => parse([{ ...blocks[0], text: blocks[0].text.replace('[3-4]', '[4-3]') }]), isFormatError);
assert.equal(adapter.schoolTransport, null);

const reader = fs.readFileSync(path.join(__dirname, '../web/jufe-portal-reader.js'), 'utf8');
const origin = 'https://jwxt.jxufe.edu.cn';
const days = '一二三四五六日'.split('').map(day => '星期' + day);
const header = { cells: ['', ...days].map(textContent => ({ textContent: '  ' + textContent + '\n' })) };
const dayCells = days.map(weekday => {
  const block = blocks.find(entry => entry.weekday === weekday);
  const childNodes = block ? [{
    nodeType: 1, tagName: 'DIV', children: [{}, {}, {}, {}],
    textContent: block.text, innerText: block.text
  }] : [];
  return { colSpan: 1, rowSpan: 1, childNodes };
});
const grid = { rows: [header, { cells: [{}, ...dayCells] }] };
const termControl = { selectedIndex: 0, options: [{ textContent: termLabel }] };
const form = { querySelector: selector => selector === '#divTitle' ? { textContent: '\n个人课表 ' } : termControl };
const doc = (child, element) => ({
  location: { origin }, readyState: 'complete', querySelectorAll: () => child ? [{ contentDocument: child }] : [],
  querySelector: selector => element[selector] || null
});
const gridDoc = doc(null, { 'table#mytable': grid });
const formDoc = doc(gridDoc, { 'form#ActionForm': form });
const run = (document, pageOrigin = origin) => {
  const sandbox = vm.createContext({ document, location: { origin: pageOrigin } });
  vm.runInContext("String.prototype.trim = () => { throw new Error('portal override'); };", sandbox);
  return vm.runInContext(reader, sandbox);
};
const projection = run(doc(formDoc, {}));
assert.equal(projection.termLabel, termLabel);
assert.equal(parse(projection.blocks, projection.termLabel).courses.length, 2);
assert.equal(run(doc(null, {})).status, 'page');
assert.equal(run(formDoc, 'https://ssl.jxufe.edu.cn').status, 'origin');
dayCells[0].rowSpan = 2;
assert.equal(run(formDoc).status, 'layout');
console.log('PASS JUFE reader scope, safe whitespace, calendar binding, grid decoding, and unverified input rejection');
