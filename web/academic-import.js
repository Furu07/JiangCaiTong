/* User-selected, de-identified JCT exchange data. Never stores the input document. */
(function () {
  'use strict';

  const key = 'jct.academic.imports.v1';
  const maxBytes = 256 * 1024;
  const maxTerms = 12;

  function checkedText(content) {
    if (typeof content !== 'string' || !content.trim()) throw new Error('请选择文件或粘贴脱敏课表');
    if (content.length > maxBytes || new TextEncoder().encode(content).length > maxBytes) {
      throw new Error('课表样本超过 256 KB');
    }
    return content.trim();
  }

  function parse(content) {
    const text = checkedText(content);
    const format = text[0] === '{' ? 'json' : text[0] === '<' ? 'html' : '';
    if (!format) throw new Error('请选择 UTF-8 的 JCT JSON 或 HTML 样本');
    return JufeAcademicAdapter.parseSchedule({ format, content: text });
  }

  function inspectSchoolSample(content, parsers = JufeAcademicAdapter.schoolParsers) {
    const text = checkedText(content);
    let format;
    let summary;
    if (text[0] === '{' || text[0] === '[') {
      let value;
      try { value = JSON.parse(text); } catch (error) { throw new Error('学校原始 JSON 语法无效'); }
      if (value && (value.log && Array.isArray(value.log.entries)
          || Object.keys(value).some(key => /^(cookie|cookies|token|password|headers|authorization)$/i.test(key)))) {
        throw new Error('请只选择脱敏课表响应，移除抓包记录和认证字段');
      }
      if (!Array.isArray(value) && value.schema === 'jct-timetable/1') {
        throw new Error('此文件是 JCT 交换格式，请选择对应的导入类型');
      }
      format = 'jufe-json';
      summary = Array.isArray(value) ? 'JSON 数组 · ' + value.length + ' 个元素'
        : 'JSON 对象 · ' + Object.keys(value).length + ' 个顶层字段';
    } else if (text[0] === '<') {
      const template = document.createElement('template');
      template.innerHTML = text;
      if (template.content.querySelector('input[type="password"], form[action*="login" i]')) {
        throw new Error('此片段含登录表单，请仅保留脱敏课表表格');
      }
      if (template.content.querySelector('table[data-schema="jct-timetable/1"]')) {
        throw new Error('此文件是 JCT 交换格式，请选择对应的导入类型');
      }
      const tables = template.content.querySelectorAll('table');
      format = 'jufe-html';
      summary = 'HTML 片段 · ' + tables.length + ' 个表格';
    } else {
      throw new Error('请选择 UTF-8 的学校原始 HTML 或 JSON 响应片段');
    }
    const enabled = typeof parsers[format] === 'function';
    return { summary, schedule: enabled ? JufeAcademicAdapter.parseSchedule({ format, content: text }, parsers) : null };
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
      save(schedule, { replaceWithEmpty = false } = {}) {
        const normalized = Academic.normalizeSchedule(schedule);
        const existing = entries.find(entry => entry.schedule.termId === normalized.termId);
        if (!replaceWithEmpty && !normalized.courses.length && existing && existing.schedule.courses.length) {
          const error = new Error('样本声明课表为空，原课表仍保留');
          error.code = 'empty-replacement';
          throw error;
        }
        const next = entries.filter(entry => entry.schedule.termId !== schedule.termId);
        if (next.length >= maxTerms) throw new Error('最多保存 12 个导入学期，请先移除一个');
        commit([...next, { schedule: normalized, importedAt: Date.now() }]);
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

  window.AcademicImport = { parse, inspectSchoolSample, createStore, readFile };
})();
