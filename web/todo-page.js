'use strict';

{
  const store = JctTodo.create({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value)
  });
  const title = $('todoTitle');
  const editor = $('todoEditor');
  const editTitle = $('todoEditTitle');
  const notes = $('todoNotes');
  const due = $('todoDue');
  const status = $('todoStatus');
  const editStatus = $('todoEditStatus');
  let filter = 'open';
  let editing = null;

  function render(focusId) {
    const items = store.list();
    const openCount = items.filter(item => !item.completed).length;
    const list = $('todoList');
    const scroll = $('page-todo').querySelector('.scroll');
    const scrollTop = scroll.scrollTop;
    $('todoCount').textContent = store.error ? '' : openCount + ' 项未完成';
    const content = document.createDocumentFragment();
    const groups = filter === 'all' ? [false, true] : [filter === 'done'];
    let focus;
    for (const completed of groups) {
      const visible = items.filter(item => item.completed === completed);
      if (filter === 'all' && visible.length) {
        content.appendChild(node('h2', (completed ? '已完成' : '未完成') + ' · ' + visible.length, 'todo-group-heading'));
      }
      for (const item of visible) {
        const row = node('div', null, item.completed ? 'todo-row completed' : 'todo-row');
        const hit = node('label', null, 'todo-check');
        const check = node('input');
        check.type = 'checkbox';
        check.checked = item.completed;
        check.setAttribute('aria-label', (item.completed ? '恢复未完成：' : '完成：') + item.title);
        check.addEventListener('change', () => {
          try {
            store.toggle(item.id);
            status.textContent = '';
            render(item.id);
          } catch (error) {
            check.checked = item.completed;
            status.textContent = error.message;
          }
        });
        hit.appendChild(check);
        if (item.id === focusId) focus = check;
        const edit = node('button', null, 'todo-content');
        edit.type = 'button';
        edit.dataset.todoId = item.id;
        edit.appendChild(node('span', item.title, 'todo-name'));
        if (item.description) edit.appendChild(node('small', item.description));
        if (item.dueAt) {
          const overdue = !item.completed && item.dueAt < new Date().toLocaleDateString('sv-SE');
          edit.appendChild(node('span', '截止 ' + item.dueAt, overdue ? 'badge warning' : 'badge muted'));
        }
        edit.addEventListener('click', () => openEditor(item));
        row.append(hit, edit);
        content.appendChild(row);
      }
    }
    if (!content.childNodes.length && !store.error) {
      const message = filter === 'done' ? '已完成的待办会出现在这里。'
        : items.length ? '目前没有未完成待办。' : '还没有待办，试试从上方添加。';
      content.appendChild(node('p', message, 'empty-state'));
    }
    list.replaceChildren(content);
    scroll.scrollTop = scrollTop;
    if (focusId) (focus || document.querySelector('[data-todo-filter][aria-pressed="true"]')).focus({ preventScroll: true });
  }

  function confirmDelete(show) {
    $('todoDeleteConfirm').hidden = !show;
    $('todoEditActions').hidden = show;
    if (show) $('todoKeep').focus({ preventScroll: true });
  }

  function openEditor(item) {
    editing = item.id;
    editTitle.value = item.title;
    notes.value = item.description;
    due.value = item.dueAt || '';
    editStatus.textContent = '';
    confirmDelete(false);
    setOverlay(editor, true);
    $('todoCancel').focus();
  }

  function closeEditor() {
    if (editor.hidden) return false;
    const id = editing;
    editing = null;
    setOverlay(editor, false);
    const trigger = Array.from(document.querySelectorAll('[data-todo-id]')).find(button => button.dataset.todoId === id);
    (trigger || title).focus({ preventScroll: true });
    return true;
  }
  window.closeTodoEditor = closeEditor;

  $('todoForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      store.add({ title: title.value });
      title.value = '';
      if (filter === 'done') selectFilter('open');
      status.textContent = '';
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  $('todoEditForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!editing || !$('todoDeleteConfirm').hidden) return;
    try {
      store.edit(editing, { title: editTitle.value, description: notes.value, dueAt: due.value });
      render();
      closeEditor();
    } catch (error) {
      editStatus.textContent = error.message;
    }
  });

  $('todoCancel').addEventListener('click', closeEditor);
  editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });
  $('todoDelete').addEventListener('click', () => confirmDelete(true));
  $('todoKeep').addEventListener('click', () => {
    confirmDelete(false);
    $('todoDelete').focus({ preventScroll: true });
  });
  $('todoConfirmDelete').addEventListener('click', () => {
    if (!editing) return;
    try {
      store.remove(editing);
      render();
      closeEditor();
    } catch (error) {
      editStatus.textContent = error.message;
    }
  });

  const filters = document.querySelectorAll('[data-todo-filter]');
  function selectFilter(value) {
    filter = value;
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.todoFilter === value)));
  }
  filters.forEach(button => button.addEventListener('click', () => {
    selectFilter(button.dataset.todoFilter);
    render();
  }));
  status.textContent = store.error;
  title.disabled = $('todoSave').disabled = !!store.error;
  render();
}
