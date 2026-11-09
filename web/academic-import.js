/* User-selected, de-identified JCT exchange data. Never stores the input document. */
(function () {
  'use strict';

  const key = 'jct.academic.imports.v1';
  const maxBytes = 256 * 1024;
  const maxTerms = 12;

  function parse(content) {
    if (typeof content !== 'string' || !content.trim()) throw new Error('请选择文件或粘贴脱敏课表');
    if (content.length > maxBytes || new TextEncoder().encode(content).length > maxBytes) {
      throw new Error('课表样本超过 256 KB');
    }
    const text = content.trim();
    const format = text[0] === '{' ? 'json' : text[0] === '<' ? 'html' : '';
    if (!format) throw new Error('请选择 UTF-8 的 JCT JSON 或 HTML 样本');
    return JufeAcademicAdapter.parseSchedule({ format, content: text });
  }

  function createStore(storage) {
    let entries = [];
    try {
      const stored = JSON.parse(storage.getItem(key));
      if (Array.isArray(stored)) {
        for (const item of stored.slice(0, maxTerms)) {
          try {
            const schedule = Academic.normalizeSchedule(item.schedule);
            if (Number.isFinite(item.importedAt)) entries.push({ schedule, importedAt: item.importedAt });
          } catch (error) {
            // A bad local entry does not hide the remaining imported terms.
          }
        }
      }
    } catch (error) {
      // Local storage may be unavailable.
    }

    function commit(next) {
      try {
        storage.setItem(key, JSON.stringify(next));
      } catch (error) {
        throw new Error('无法写入本地存储，原课表保留');
      }
      entries = next;
    }

    return {
      list: () => entries.map(entry => ({ termId: entry.schedule.termId, term: entry.schedule.term })),
      read(termId) {
        const entry = entries.find(item => item.schedule.termId === termId);
        return entry ? { schedule: entry.schedule, syncedAt: entry.importedAt } : null;
      },
      save(schedule) {
        const next = entries.filter(entry => entry.schedule.termId !== schedule.termId);
        if (next.length >= maxTerms) throw new Error('最多保存 12 个导入学期，请先移除一个');
        commit([...next, { schedule, importedAt: Date.now() }]);
      },
      remove(termId) {
        commit(entries.filter(entry => entry.schedule.termId !== termId));
      }
    };
  }

  function readFile(file) {
    if (file.size > maxBytes) return Promise.reject(new Error('课表样本超过 256 KB'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(reader.result));
        } catch (error) {
          reject(new Error('请选择 UTF-8 编码的课表样本'));
        }
      };
      reader.onerror = () => reject(new Error('无法读取所选文件'));
      reader.readAsArrayBuffer(file);
    });
  }

  window.AcademicImport = { parse, createStore, readFile };
})();
