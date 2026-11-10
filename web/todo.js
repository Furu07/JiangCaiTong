/* One app-private document, independent of any account. */
(function () {
  'use strict';
  const key = 'jct.todo.v1';
  const unreadable = '无法读取本机待办。请重新打开应用后重试。';

  function fields(input) {
    const title = input.title.trim();
    const description = (input.description || '').trim();
    const dueAt = input.dueAt || null;
    if (!title || title.length > 120) throw new Error('请输入 1–120 字的待办标题。');
    if (description.length > 1000) throw new Error('备注不能超过 1000 字。');
    if (dueAt && (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt)
        || !Number.isFinite(Date.parse(dueAt))
        || new Date(dueAt).toISOString().slice(0, 10) !== dueAt)) {
      throw new Error('请输入有效的截止日期。');
    }
    return { title, description, dueAt };
  }

  function create(storage, now = Date.now) {
    let rows;
    try {
      const raw = storage.getItem(key);
      const saved = raw === null ? { version: 1, items: [] } : JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error();
      const ids = new Set();
      rows = saved.items.map(item => {
        if (typeof item.id !== 'string' || !item.id || ids.has(item.id)
            || typeof item.completed !== 'boolean' || !Number.isFinite(item.createdAt)
            || !Number.isFinite(item.updatedAt)
            || (item.completed ? !Number.isFinite(item.completedAt) : item.completedAt != null)) throw new Error();
        ids.add(item.id);
        return { ...item, ...fields(item), completedAt: item.completedAt ?? null };
      });
    } catch (_) {
      rows = null;
    }

    function write(next) {
      try {
        storage.setItem(key, JSON.stringify({ version: 1, items: next }));
      } catch (_) {
        throw new Error('待办保存失败，原有内容已保留。');
      }
      rows = next;
    }

    function modify(id, action) {
      if (!rows) throw new Error(unreadable);
      const index = rows.findIndex(item => item.id === id);
      if (index < 0) throw new Error('这项待办已不存在。');
      const next = rows.slice();
      next.splice(index, 1, ...action(rows[index]));
      write(next);
    }

    return {
      error: rows ? '' : unreadable,
      list: () => (rows || []).map(item => ({ ...item })),
      add(input) {
        if (!rows) throw new Error(unreadable);
        const at = now();
        let id;
        do {
          id = Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
        } while (rows.some(item => item.id === id));
        write([{ id, ...fields(input), completed: false, createdAt: at, updatedAt: at, completedAt: null }, ...rows]);
      },
      edit(id, input) {
        modify(id, item => [{ ...item, ...fields(input), updatedAt: now() }]);
      },
      toggle(id) {
        modify(id, item => {
          const at = now();
          return [{ ...item, completed: !item.completed, updatedAt: at, completedAt: item.completed ? null : at }];
        });
      },
      remove(id) { modify(id, () => []); }
    };
  }

  const api = { create, key };
  if (typeof module !== 'undefined') module.exports = api;
  else window.JctTodo = api;
}());
