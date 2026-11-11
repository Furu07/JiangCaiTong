(function () {
  'use strict';

  const availabilityLabels = {
    available: '可用', occupied: '占用', offline: '离线', unknown: '可用状态未知'
  };
  const stateLabels = {
    DISCONNECTED: '未连接', CONNECTING: '连接中', READY: '已连接，可使用',
    STARTING: '正在开始', RUNNING: '洗浴进行中', STOPPING: '正在结束',
    FINISHED: '使用结束', UNKNOWN: '设备状态无法确认', ERROR: '服务方拒绝操作'
  };

  function mount(service) {
    const find = id => document.getElementById(id);
    const building = find('zhuliBuilding');
    const floor = find('zhuliFloor');
    const list = find('zhuliDeviceList');
    const actions = {
      refresh: 'zhuliRefresh', connect: 'zhuliConnect', check: 'zhuliCheck',
      disconnect: 'zhuliDisconnect', start: 'zhuliStart', stop: 'zhuliStop'
    };

    function options(select, values, placeholder) {
      const value = select.value;
      const names = [...new Set(values.filter(Boolean))];
      select.replaceChildren(new Option(placeholder, ''), ...names.map(name => new Option(name, name)));
      select.value = names.includes(value) ? value : '';
      select.hidden = !names.length;
    }

    function render(focusId) {
      const view = service.snapshot();
      const { access, devices, refreshedAt, selected, state, can, problem, pending } = view;
      const authorized = access === 'authorized';
      find('zhuliProject').textContent = view.project || '江西财经大学麦庐园校区洗浴、直饮水项目';
      const status = find('zhuliDeviceStatus');
      status.dataset.tone = problem ? 'warning' : '';
      status.textContent = problem || (access === 'unconfigured' ? '原生设备查询待服务方授权。'
        : !authorized ? '请先完成住理生活账户授权。'
        : pending && !selected ? '正在读取设备…'
        : !refreshedAt ? '请刷新设备列表。'
        : !devices.length ? '当前项目暂无可显示的设备。' : '');
      find('zhuliDeviceTime').textContent = refreshedAt
        ? '最近刷新 ' + new Date(refreshedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      options(building, devices.map(device => device.building), '全部楼栋');
      const scoped = devices.filter(device => !building.value || device.building === building.value);
      options(floor, scoped.map(device => device.floor), '全部楼层');
      const shown = scoped.filter(device => !floor.value || device.floor === floor.value);
      list.replaceChildren();
      for (const device of shown) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'course-list-item';
        button.disabled = !can.choose;
        button.setAttribute('aria-pressed', String(device.id === selected?.id));
        const title = document.createElement('span');
        title.className = 'course-name';
        title.textContent = device.label;
        const detail = document.createElement('span');
        detail.className = 'course-meta';
        detail.textContent = [device.building, device.floor, device.room, availabilityLabels[device.availability]]
          .filter(Boolean).join(' · ');
        button.append(title, detail);
        button.addEventListener('click', () => {
          if (service.select(device.id)) render(device.id);
        });
        list.appendChild(button);
        if (device.id === focusId) button.focus({ preventScroll: true });
      }
      if (refreshedAt && devices.length && !shown.length) list.textContent = '所选区域暂无设备。';
      find('zhuliSelection').hidden = !selected;
      find('zhuliSelectedName').textContent = selected?.label || '';
      find('zhuliConnection').textContent = selected
        ? [stateLabels[state], availabilityLabels[selected.availability]].join(' · ') : '';
      find('zhuliFee').textContent = view.feeNotice;
      for (const [action, id] of Object.entries(actions)) {
        find(id).hidden = !can[action];
      }
    }

    building.addEventListener('change', () => { floor.value = ''; render(); });
    floor.addEventListener('change', () => render());
    for (const [action, id] of Object.entries(actions)) {
      find(id).addEventListener('click', async () => {
        if (action === 'start') {
          const view = service.snapshot();
          if (!view.can.start || !window.confirm(view.selected.label + '\n' + view.feeNotice + '\n确认开始洗浴？')) return;
        }
        const result = service[action](true);
        render();
        await result;
        render();
      });
    }
    return { render };
  }

  window.ZhuliDevicePage = { mount };
})();
