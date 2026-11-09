/* Evaluated by the isolated academic WebView, never loaded by the app page. */
(function () {
  const origin = 'https://jwxt.jxufe.edu.cn';
  if (location.origin !== origin) return { status: 'origin' };
  const clean = text => text.replace(/^\s+|\s+$/g, '');
  const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const documents = [document];
  for (let i = 0; i < documents.length && i < 12; i++) {
    const doc = documents[i];
    const frames = Array.from(doc.querySelectorAll('iframe,frame')).slice(0, 16);
    const children = frames.map(frame => frame.contentDocument).filter(child =>
      child && child.location.origin === origin && child.readyState !== 'loading');
    for (const child of children) {
      if (documents.length < 12 && !documents.includes(child)) documents.push(child);
    }
    const form = doc.querySelector('form#ActionForm');
    const title = form && form.querySelector('#divTitle');
    if (!title || clean(title.textContent) !== '个人课表') continue;
    const term = form.querySelector('select#xnxq');
    const option = term && term.options[term.selectedIndex];
    if (!option) return { status: 'term' };
    const grids = children.map(child => child.querySelector('table#mytable')).filter(Boolean);
    if (grids.length !== 1) return { status: 'grid' };
    const grid = grids[0];
    if (grid.rows.length < 2 || grid.rows.length > 40 || grid.rows[0].cells.length !== 8
        || weekdays.some((day, index) => clean(grid.rows[0].cells[index + 1].textContent) !== day)) {
      return { status: 'layout' };
    }
    const blocks = [];
    for (let rowIndex = 1; rowIndex < grid.rows.length; rowIndex++) {
      const cells = Array.from(grid.rows[rowIndex].cells);
      if (cells.length !== 8 && cells.length !== 9) return { status: 'layout' };
      const dayCells = cells.slice(-7);
      for (let day = 0; day < dayCells.length; day++) {
        const cell = dayCells[day];
        if (cell.colSpan !== 1 || cell.rowSpan !== 1) return { status: 'layout' };
        for (const item of cell.childNodes) {
          if (!clean(item.textContent || '')) continue;
          if (item.nodeType !== 1 || item.tagName !== 'DIV' || item.children.length !== 4
              || blocks.length >= 120) return { status: 'layout' };
          const lines = item.innerText.split(/\r?\n/).map(clean);
          if (lines.length !== 4 || lines.some(line => !line || line.length > 100)) return { status: 'layout' };
          blocks.push({ weekday: weekdays[day], text: lines.join('\n') });
        }
      }
    }
    const termLabel = clean(option.textContent);
    if (!/^20\d{2}-20\d{2}学年第[一二]学期$/.test(termLabel)) return { status: 'term' };
    return blocks.length ? { termLabel, blocks } : { status: 'empty' };
  }
  return { status: 'page' };
})()
