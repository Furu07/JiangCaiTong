'use strict';

{
  const store = JctTodo.create({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value)
  });
  const title = $('todoTitle');
  const notes = $('todoNotes');
  const due = $('todoDue');
  const status = $('todoStatus');
  let filter = 'open';
  let editing = null;

  function render() {
    const items = store.list();
    const count = items.filter(item => !item.completed).length;
    const list = $('todoList');
    empty(list);
    $('todoCount').textContent = store.error ? '' : count + ' 项未完成';
    if (store.error) return;
    const visible = items.filter(item => filter === 'all' || item.completed === (filter === 'done'));
    if (!visible.length) {
      list.appendChild(node('p', filter === 'done' ? '还没有已完成的待办。' : '这里还没有待办，可以从上方添加。', 'sub'));
    }
    visible.forEach(item => {
      const row = node('div', null, item.completed ? 'todo-row completed' : 'todo-row');
      const check = node('input');
      check.type = 'checkbox';
      check.checked = item.completed;
      check.setAttribute('aria-label', (item.completed ? '恢复未完成：' : '完成：') + item.title);
      check.addEventListener('change', () => {
        try {
          store.toggle(item.id);
          status.textContent = '';
          render();
        } catch (error) {
          check.checked = item.completed;
          status.textContent = error.message;
        }
      });
      const edit = node('button', null, 'todo-content');
      edit.type = 'button';
      edit.appendChild(node('span', item.title));
      if (item.description) edit.appendChild(node('small', item.description));
      if (item.dueAt) edit.appendChild(node('small', '截止 ' + item.dueAt));
      edit.addEventListener('click', () => {
        setEditor(item);
        status.textContent = '';
        title.focus();
        title.scrollIntoView({ block: 'nearest' });
      });
      row.append(check, edit);
      list.appendChild(row);
    });
  }

  function setEditor(item) {
    editing = item ? item.id : null;
    $('todoTitleLabel').textContent = item ? '编辑待办' : '快速添加待办';
    $('todoSave').textContent = item ? '保存' : '添加';
    $('todoDetails').hidden = !item;
    title.value = item ? item.title : '';
    notes.value = item ? item.description : '';
    due.value = item ? item.dueAt || '' : '';
  }

  $('todoForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const input = { title: title.value, description: notes.value, dueAt: due.value };
      if (editing) store.edit(editing, input);
      else store.add(input);
      if (!editing && filter === 'done') document.querySelector('[data-todo-filter="open"]').click();
      setEditor(null);
      status.textContent = '';
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  $('todoCancel').addEventListener('click', () => {
    setEditor(null);
    status.textContent = '';
  });
  $('todoDelete').addEventListener('click', () => {
    if (!editing || !window.confirm('删除这项待办？')) return;
    try {
      store.remove(editing);
      setEditor(null);
      status.textContent = '';
      render();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  const filters = document.querySelectorAll('[data-todo-filter]');
  filters.forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.todoFilter;
    filters.forEach(item => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
    render();
  }));
  status.textContent = store.error;
  title.disabled = $('todoSave').disabled = !!store.error;
  render();
}
