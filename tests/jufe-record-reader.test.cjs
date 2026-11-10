const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../web/jufe-record-reader.js'), 'utf8');
const origin = 'https://jwxt.jxufe.edu.cn';
const label = '2026-2027学年第一学期';
const examHeaders = ['序号', '课程', '学分', '类别', '考核方式', '修读性质', '状态', '考试时间',
  '院系审核状态', '教务处审核状态', '', ''];

function fixture(kind) {
  const grades = kind === 'grades';
  const frame = { contentDocument: null };
  let clicks = 0;
  const button = { value: '检索', click: () => { clicks++; },
    getAttribute: () => grades ? 'DoSubmit()' : 'QryData()' };
  const year = { value: '2026', disabled: !grades };
  const nextYear = { value: '2027' };
  const gradeScope = { checked: false, click() { this.checked = true; } };
  const effectiveGrade = { checked: false, click() { this.checked = true; } };
  const terms = { value: '0', disabled: !grades, dispatchEvent() {},
    options: [{ value: '0', textContent: '第一学期' }, { value: '1', textContent: '第二学期' }] };
  const cycle = { options: ['a', 'b'].map(value => ({ value, textContent: label + '考试' })),
    dispatchEvent() {} };
  const controls = {
    'input#xn[name=xn]': year,
    'input#xn1[name=xn1]': nextYear,
    'select#xq[name=xq]': terms,
    'input#sjxz3[type=radio][name=sjxzS]': gradeScope,
    'input#yxcj[type=radio][name=ysyxS]': effectiveGrade,
    'input#btnQry': button,
    'input#btnSubmit': button,
    'select#xxlc[name=xxlc]': cycle,
    '#xxlc': cycle,
    '#btnsmartdown': { click() { year.value = '2025'; nextYear.value = '2026'; } }
  };
  const document = {
    location: { origin, pathname: grades ? '/student/xscj.stuckcj.jsp' : '/student/ksap.sqhk.html' },
    querySelectorAll: () => [],
    querySelector: selector => selector === 'iframe#frmReport' ? frame
      : { querySelector: key => controls[key] }
  };
  const context = vm.createContext({ document, location: document.location, URLSearchParams, Event });
  const reader = vm.runInContext(script, context);
  return { read: (term = label) => reader(kind, term, true).status, frame, cycle, terms, gradeScope, effectiveGrade,
    result: (term = label) => reader(kind, term, true),
    clicks: () => clicks };
}

function gradeReport(message) {
  return { location: { origin, pathname: '/student/xscj.stuckcj_data10421.jsp' }, readyState: 'complete',
    body: { children: [{}], firstElementChild: { tagName: 'DIV' }, innerText: message },
    querySelector: () => null };
}

function examReport({ semester = '0', rows = [] } = {}) {
  const table = { tHead: { rows: [{ cells: examHeaders.map(textContent => ({ textContent })) }] },
    tBodies: [{ rows }], rows: [{}].concat(rows) };
  return { location: { origin, pathname: '/taglib/DataTable.jsp', search: '?tableId=2537&xn=2026&xq=' + semester },
    readyState: 'complete', querySelector: () => table };
}

test('grade no-record result must be fresh and come from the verified report', () => {
  const grade = fixture('grades');
  grade.frame.contentDocument = gradeReport('学生成绩报表没有检索到记录');
  assert.equal(grade.read('2025-2026学年第二学期'), 'waiting');
  assert.equal(grade.gradeScope.checked, true);
  assert.equal(grade.effectiveGrade.checked, true);
  assert.equal(grade.terms.value, '1');
  assert.equal(grade.read('2025-2026学年第二学期'), 'waiting');
  assert.equal(grade.clicks(), 1);
  grade.frame.contentDocument = gradeReport('学生成绩报表没有检索到记录');
  grade.gradeScope.checked = false;
  assert.equal(grade.read('2025-2026学年第二学期'), 'format');
  grade.gradeScope.checked = true;
  grade.effectiveGrade.checked = false;
  assert.equal(grade.read('2025-2026学年第二学期'), 'format');
  grade.effectiveGrade.checked = true;
  assert.equal(grade.read('2025-2026学年第二学期'), 'result');
  grade.frame.contentDocument = gradeReport('服务器错误');
  assert.equal(grade.read('2025-2026学年第二学期'), 'format');
});

test('effective grades map verified report headers and reject a different semester', () => {
  const grade = fixture('grades');
  assert.equal(grade.read(), 'waiting');
  const columns = ['序号', '学分', '课程/环节', '类别', '修读性质', '考核方式', '成绩', '获得学分', '绩点', '学分绩点', '备注'];
  const cell = text => ({ textContent: text, innerText: text, colSpan: 1, rowSpan: 1 });
  const header = { cells: columns.map(cell) };
  const sample = { cells: ['1', '2.5', '示例课程', '', '必修', '考查', '优', '2.5', '4.0', '10.0', '']
    .map(cell) };
  const heading = { tagName: 'TABLE', innerText: '学年学期：2025-2026学年第二学期' };
  const table = { previousElementSibling: heading, tHead: { rows: [header] },
    tBodies: [{ rows: [sample] }], rows: [header, sample] };
  const report = gradeReport('');
  report.querySelector = key => key === '.title' ? { innerText: '学生成绩表（有效）' } : table;
  report.querySelectorAll = () => [heading, table];
  grade.frame.contentDocument = report;
  assert.equal(grade.read(), 'format');
  heading.innerText = '学年学期：' + label;
  const result = grade.result();
  assert.equal(result.state, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows)), [{
    credits: '2.5', name: '示例课程', category: '', nature: '必修', assessment: '考查', grade: '优',
    earnedCredits: '2.5', gpa: '4.0', creditPoints: '10.0', note: ''
  }]);
});

test('exam no-record result requires all cycles of the requested term', () => {
  const exam = fixture('exams');
  assert.equal(exam.read('2025-2026学年第二学期'), 'term');
  assert.equal(exam.clicks(), 0);
  assert.equal(exam.read(), 'waiting');
  assert.equal(exam.cycle.value, 'a');
  exam.frame.contentDocument = examReport();
  assert.equal(exam.read(), 'waiting');
  assert.equal(exam.read(), 'waiting');
  assert.equal(exam.cycle.value, 'b');
  assert.equal(exam.read(), 'waiting');
  exam.frame.contentDocument = examReport();
  assert.equal(exam.read(), 'result');
});

test('exam rejects wrong-term and unknown populated reports', () => {
  const exam = fixture('exams');
  assert.equal(exam.read(), 'waiting');
  exam.frame.contentDocument = examReport({ semester: '1' });
  assert.equal(exam.read(), 'format');
  exam.frame.contentDocument = examReport({ rows: [{}] });
  assert.equal(exam.read(), 'format');
});

test('exam projects recognized rows from separate cycles without inventing a seat or location', () => {
  const exam = fixture('exams');
  const row = time => ({ cells: ['1', '示例课程', '', '', '笔试', '', '已安排', time, '', '', '', '']
    .map(innerText => ({ innerText, textContent: innerText, colSpan: 1, rowSpan: 1 })) });
  assert.equal(exam.read(), 'waiting');
  exam.frame.contentDocument = examReport({ rows: [row('2026-12-01 09:00-11:00')] });
  assert.equal(exam.read(), 'waiting');
  assert.equal(exam.read(), 'waiting');
  exam.frame.contentDocument = examReport({ rows: [row('具体时间另行通知'), row('2026-02-30 09:00-11:00'),
    row('2026-12-02 23:00-01:00')] });
  const result = exam.result();
  assert.equal(result.state, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows)), [
    { name: '示例课程', date: '2026-12-01', start: '09:00', end: '11:00', mode: '笔试', status: '已安排' },
    { name: '示例课程', timeText: '具体时间另行通知', mode: '笔试', status: '已安排' },
    { name: '示例课程', timeText: '2026-02-30 09:00-11:00', mode: '笔试', status: '已安排' },
    { name: '示例课程', timeText: '2026-12-02 23:00-01:00', mode: '笔试', status: '已安排' }
  ]);
});
