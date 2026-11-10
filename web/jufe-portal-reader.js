/* Evaluated by the isolated academic WebView, never loaded by the app page. */
(function (requestedTerm, navigate, ownerOnly) {
  const origin = 'https://jwxt.jxufe.edu.cn';
  if (location.origin !== origin) return { status: 'origin' };
  const clean = text => text.replace(/^\s+|\s+$/g, '');
  const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const documents = [document];
  const field = (root, name) => root.querySelector('input[type=hidden][name=' + name + ']')?.value || '';
  const footer = document.querySelector('footer .yearterm');
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
    const termLabel = clean(option.textContent);
    if (requestedTerm && requestedTerm !== termLabel) {
      const index = Array.from(term.options).findIndex(item => clean(item.textContent) === requestedTerm);
      if (index < 0) return { status: 'term' };
      term.selectedIndex = index;
      term.dispatchEvent(new Event('change', { bubbles: true }));
      return { status: 'waiting' };
    }
    const owner = field(form, 'xh');
    if (ownerOnly) return /^\d{5,20}$/.test(owner) ? { owner } : { status: 'owner' };
    const grids = children.map(child => child.querySelector('table#mytable')).filter(Boolean);
    if (grids.length !== 1) return { status: 'grid' };
    const grid = grids[0];
    const gridDoc = grid.ownerDocument;
    const year = field(form, 'xn');
    const part = field(form, 'xq');
    if (!/^20\d{2}$/.test(year) || !/^[01]$/.test(part) || option.value !== year + '-' + part
        || field(gridDoc, 'xn') !== year || field(gridDoc, 'xq_m') !== part) return { status: 'waiting' };
    if (!/^\d{5,20}$/.test(owner) || field(gridDoc, 'xh') !== owner) return { status: 'owner' };
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
    if (!/^20\d{2}-20\d{2}学年第[一二]学期$/.test(termLabel)) return { status: 'term' };
    const terms = Array.from(term.options, item => clean(item.textContent)).filter(
      label => /^20\d{2}-20\d{2}学年第[一二]学期$/.test(label));
    return blocks.length ? { termLabel, blocks, owner, terms, current: footer ? clean(footer.textContent) : '' }
      : { status: 'empty' };
  }
  if (navigate) {
    const links = documents.flatMap(doc => Array.from(doc.querySelectorAll('a.conTitle')).filter(
      link => !link.hasAttribute('href') && clean(link.textContent) === '教学安排'));
    if (links.length === 1) {
      links[0].click();
      return { status: 'opened' };
    }
  }
  return { status: 'page' };
})
