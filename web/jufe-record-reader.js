/* Runs inside the same isolated school WebView after its owner was verified. */
(function readJufeRecord(kind, requestedTerm, navigate) {
  const origin = 'https://jwxt.jxufe.edu.cn';
  const history = kind === 'grade-terms';
  const grades = kind === 'grades' || history;
  if (location.origin !== origin || (!grades && kind !== 'exams')) return { status: 'format' };
  const clean = value => (value || '').replace(/^\s+|\s+$/g, '');
  const match = /^(20\d{2})-(20\d{2})学年第([一二])学期$/.exec(requestedTerm);
  if (history ? requestedTerm !== '' : !match) return { status: 'term' };
  const [, year, nextYear, part] = match || [];
  const semester = part === '一' ? '0' : '1';
  const menu = grades ? '学业成绩' : '课程考试';
  const page = grades ? '/student/xscj.stuckcj.jsp' : '/student/ksap.sqhk.html';
  const reportPath = grades ? '/student/xscj.stuckcj_data10421.jsp' : '/taglib/DataTable.jsp';
  const docs = [document];
  for (let i = 0; i < docs.length && docs.length < 12; i++) {
    for (const frame of docs[i].querySelectorAll('iframe,frame')) {
      const child = frame.contentDocument;
      if (child && child.location.origin === origin && child.readyState !== 'loading'
          && docs.length < 12 && !docs.includes(child)) docs.push(child);
    }
  }
  const doc = docs.find(item => item.location.pathname === page);
  if (!doc) {
    if (navigate) {
      const links = docs.flatMap(item => Array.from(item.querySelectorAll('a.conTitle:not([href])')))
        .filter(link => clean(link.textContent) === menu);
      if (links.length === 1) {
        links[0].click();
        return { status: 'opened' };
      }
    }
    return { status: 'waiting', phase: 'menu' };
  }
  const form = doc.querySelector('form#ActionForm[method=post][target=frmReport]');
  const frame = doc.querySelector('iframe#frmReport');
  const xn = form?.querySelector('input#xn[name=xn]');
  const xn1 = form?.querySelector('input#xn1[name=xn1]');
  const xq = form?.querySelector('select#xq[name=xq]');
  const gradeScope = grades ? form?.querySelector(history
    ? 'input#sjxz1[type=radio][name=sjxzS]' : 'input#sjxz3[type=radio][name=sjxzS]') : null;
  const effectiveGrade = grades ? form?.querySelector('input#yxcj[type=radio][name=ysyxS]') : null;
  const button = form?.querySelector(grades ? 'input#btnQry' : 'input#btnSubmit');
  const handler = grades ? /\bDoSubmit\s*\(/ : /\bQryData\s*\(/;
  if (!frame || !xn || !xn1 || !xq || !button || button.value !== '检索'
      || !handler.test(button.getAttribute('onclick') || '')) return { status: 'format' };
  if (grades && (!gradeScope || gradeScope.disabled || !effectiveGrade || effectiveGrade.disabled)) {
    return { status: 'format' };
  }

  let run = doc.__jctRecordRead;
  if (!run) {
    if (effectiveGrade && !effectiveGrade.checked) effectiveGrade.click();
    if (gradeScope && !gradeScope.checked) gradeScope.click();
    if (!history && xn.value !== year) {
      if (xn.disabled || !/^20\d{2}$/.test(xn.value)) return { status: 'term' };
      const direction = Number(year) - Number(xn.value);
      const step = form.querySelector(direction > 0 ? '#btnsmartup' : '#btnsmartdown');
      if (!step || step.disabled || Math.abs(direction) > 6) return { status: 'term' };
      for (let i = 0; i < Math.abs(direction); i++) step.click();
    }
    if (!history) {
      if (xn.value !== year || xn1.value !== nextYear) return { status: 'term' };
      const option = Array.from(xq.options).find(item =>
        item.value === semester && clean(item.textContent) === '第' + part + '学期');
      if (!option || (xq.disabled && xq.value !== semester)) return { status: 'term' };
      if (xq.value !== semester) {
        xq.value = semester;
        xq.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    run = doc.__jctRecordRead = { previous: null, submitted: false, cycles: null, index: 0, rows: [] };
  }
  if (grades && (!effectiveGrade.checked || !gradeScope.checked)) return { status: 'format' };
  if (!history && (xn.value !== year || xn1.value !== nextYear || xq.value !== semester)) return { status: 'term' };

  if (!grades && !run.cycles) {
    const cycle = form.querySelector('select#xxlc[name=xxlc]');
    if (!cycle || cycle.disabled) return { status: 'format' };
    const options = Array.from(cycle.options).filter(item => item.value && !item.disabled);
    if (!options.length || options.some(item => !clean(item.textContent).startsWith(requestedTerm))) {
      return { status: 'waiting', phase: 'cycles' };
    }
    if (options.length > 8 || new Set(options.map(item => item.value)).size !== options.length) {
      return { status: 'format' };
    }
    run.cycles = options.map(item => item.value);
  }

  if (!run.submitted) {
    if (!grades) {
      const cycle = form.querySelector('#xxlc');
      cycle.value = run.cycles[run.index];
      if (cycle.value !== run.cycles[run.index]) return { status: 'format' };
      cycle.dispatchEvent(new Event('change', { bubbles: true }));
    }
    run.previous = frame.contentDocument;
    run.submitted = true;
    button.click();
    return { status: 'waiting', phase: 'submitted' };
  }

  const report = frame.contentDocument;
  if (!report || report === run.previous || report.location.origin !== origin
      || report.readyState !== 'complete') return { status: 'waiting', phase: 'report' };
  if (report.location.pathname !== reportPath) return { status: 'format' };
  if (grades) {
    if (report.body.children.length === 1 && report.body.firstElementChild.tagName === 'DIV'
        && !report.querySelector('table') && /学生成绩.*没有检索到记录/.test(report.body.innerText.replace(/\s+/g, ''))) {
      return { status: 'result', state: 'empty', rows: [] };
    }
    return readGrades(report);
  }

  const params = new URLSearchParams(report.location.search);
  if (params.get('tableId') !== '2537' || params.get('xn') !== year || params.get('xq') !== semester) {
    return { status: 'format' };
  }
  const table = report.querySelector('table#keywords');
  const header = table?.tHead?.rows[0];
  const labels = ['序号', '课程', '学分', '类别', '考核方式', '修读性质', '状态', '考试时间', '院系审核状态', '教务处审核状态', '', ''];
  if (!header || header.cells.length !== labels.length || table.tBodies.length !== 1
      || labels.some((label, i) => clean(header.cells[i].textContent) !== label)) return { status: 'format' };
  const rows = table.tBodies[0].rows;
  if (table.rows.length !== 1 + rows.length || run.rows.length + rows.length > 240) return { status: 'format' };
  for (const row of rows) {
    const cells = row.cells;
    if (!cells || cells.length !== labels.length || !/^\d{1,4}$/.test(clean(cells[0].textContent))
        || Array.from(cells).some(cell => cell.rowSpan !== 1 || cell.colSpan !== 1)) {
      return { status: 'format' };
    }
    const name = clean(cells[1].innerText);
    const timeText = clean(cells[7].innerText);
    if (!name || name.length > 240 || timeText.length > 240) return { status: 'format' };
    run.rows.push({ name, ...examTiming(timeText), mode: clean(cells[4].innerText), status: clean(cells[6].innerText) });
  }
  if (++run.index === run.cycles.length) {
    return { status: 'result', state: run.rows.length ? 'ready' : 'empty', rows: run.rows };
  }
  run.submitted = false;
  return { status: 'waiting' };

  function readGrades(report) {
    const title = clean(report.querySelector('.title')?.innerText);
    if (!title.includes('成绩') || !title.includes('有效')) return { status: 'format' };
    const fields = new Map(Object.entries({
      序号: 'sequence', '课程/环节': 'name', 学分: 'credits', 类别: 'category', 修读性质: 'nature',
      考核方式: 'assessment', 成绩: 'grade', 获得学分: 'earnedCredits', 绩点: 'gpa', 学分绩点: 'creditPoints', 备注: 'note'
    }));
    const tables = Array.from(report.querySelectorAll('table')).filter(table => table.tHead);
    const columns = table => {
      if (table.tHead.rows.length !== 1) return null;
      const keys = Array.from(table.tHead.rows[0].cells, cell => fields.get(clean(cell.textContent).replace(/\s+/g, '')));
      return keys.length === fields.size && keys.every(Boolean) && new Set(keys).size === fields.size ? keys : null;
    };
    const termHeading = table => {
      const heading = table.previousElementSibling;
      if (heading?.tagName !== 'TABLE') return null;
      const labels = clean(heading.innerText).replace(/\s+/g, '').match(/20\d{2}-20\d{2}学年第[一二]学期/g);
      return labels && labels.every(label => label === labels[0]) ? labels[0] : null;
    };
    if (history) {
      const labels = new Set();
      for (const table of tables) {
        const label = termHeading(table);
        if (!label) continue;
        if (!columns(table)) return { status: 'format' };
        if (Array.from(table.tBodies).some(body => body.rows.length)) labels.add(label);
      }
      if (!labels.size || labels.size > 64) return { status: 'format' };
      return { status: 'result', state: 'ready', rows: Array.from(labels, label => ({ label })) };
    }
    if (tables.length !== 1) return { status: 'format' };
    const table = tables[0];
    const keys = columns(table);
    const body = table.tBodies[0]?.rows;
    if (termHeading(table) !== requestedTerm || !keys || table.tBodies.length !== 1 || !body || !body.length || body.length > 240
        || table.rows.length !== 1 + body.length) return { status: 'format' };

    const rows = [];
    for (const row of body) {
      if (row.cells.length !== keys.length || Array.from(row.cells).some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1)) {
        return { status: 'format' };
      }
      const record = Object.fromEntries(keys.map((key, i) => [key, clean(row.cells[i].innerText)]));
      const { sequence, ...grade } = record;
      if (!/^\d{1,4}$/.test(sequence) || !grade.name
          || Object.values(grade).some(value => value.length > 240)) return { status: 'format' };
      rows.push(grade);
    }
    return { status: 'result', state: 'ready', rows };
  }

  function examTiming(timeText) {
    const period = /^(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?\s+([01]\d|2[0-3]):([0-5]\d)\s*[-–—~～至]\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(timeText);
    if (!period) return { timeText };
    const date = [period[1], period[2].padStart(2, '0'), period[3].padStart(2, '0')].join('-');
    const parsed = new Date(date);
    const start = period[4] + ':' + period[5];
    const end = period[6] + ':' + period[7];
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || start >= end) {
      return { timeText };
    }
    return { date, start, end };
  }
})
