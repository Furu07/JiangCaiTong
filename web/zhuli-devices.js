/* Device state for an authorized Zhuli adapter. The bundled app has no service transport. */
(function () {
  'use strict';

  const availability = new Set(['available', 'occupied', 'offline', 'unknown']);
  const confirmedStates = new Set(['DISCONNECTED', 'READY', 'RUNNING', 'FINISHED']);
  const canSwitchDevice = state => state === 'DISCONNECTED' || state === 'FINISHED';

  function normalizeCatalog(result) {
    if (typeof result?.project !== 'string' || !result.project.trim() || !Array.isArray(result.devices)) {
      throw new Error('Invalid device catalog');
    }
    const ids = new Set();
    const devices = result.devices.map(device => {
      if (typeof device?.id !== 'string' || !device.id.trim() || ids.has(device.id)) {
        throw new Error('Invalid or duplicate device identifier');
      }
      ids.add(device.id);
      const label = typeof device.label === 'string' ? device.label.trim() : '';
      const location = field => typeof device[field] === 'string' ? device[field].trim() : '';
      return Object.freeze({
        id: device.id, label: label || device.id,
        building: location('building'), floor: location('floor'), room: location('room'),
        availability: availability.has(device.availability) ? device.availability : 'unknown'
      });
    });
    return { project: result.project.trim(), devices };
  }

  function create(adapter, now = Date.now) {
    let scope = null;
    let revision = 0;
    let catalog = null;
    let refreshedAt = null;
    let selected = null;
    let state = 'DISCONNECTED';
    let feeNotice = '';
    let pending = false;
    let problem = '';

    function syncScope() {
      let next = null;
      try {
        const value = adapter?.scope();
        if (typeof value === 'string' && value) next = value;
      } catch (_) { /* A failed session check hides account data. */ }
      if (next === scope) return;
      scope = next;
      revision++;
      catalog = refreshedAt = selected = null;
      state = 'DISCONNECTED';
      feeNotice = problem = '';
    }

    function snapshot() {
      syncScope();
      const idle = !!scope && !pending;
      const canSwitch = idle && canSwitchDevice(state);
      const has = method => typeof adapter?.[method] === 'function';
      const canVerify = !!selected && has('readStatus');
      const controls = adapter?.controlsVerified === true && canVerify;
      return {
        access: !adapter ? 'unconfigured' : scope ? 'authorized' : 'needs-auth',
        project: catalog?.project || '',
        devices: catalog?.devices.slice() || [],
        refreshedAt, selected, state, feeNotice, pending, problem,
        can: {
          refresh: idle && has('listDevices'),
          choose: canSwitch,
          connect: canSwitch && selected?.availability === 'available' && canVerify && has('connect'),
          check: idle && canVerify,
          disconnect: idle && state === 'READY' && canVerify && has('disconnect'),
          start: idle && state === 'READY' && !!feeNotice && controls && has('start'),
          stop: idle && state === 'RUNNING' && controls && has('stop')
        }
      };
    }

    async function request(call, apply, failed) {
      const owner = scope;
      const version = revision;
      pending = true;
      problem = '';
      try {
        const result = await call(owner);
        syncScope();
        if (version !== revision) return false;
        return apply(result);
      } catch (_) {
        syncScope();
        if (version === revision) failed();
        return false;
      } finally {
        pending = false;
      }
    }

    function refresh() {
      if (!snapshot().can.refresh) return false;
      return request(owner => adapter.listDevices(owner), reply => {
        const next = normalizeCatalog(reply);
        catalog = next;
        refreshedAt = now();
        if (selected) {
          const updated = next.devices.find(device => device.id === selected.id);
          // Keep the device ID for status checks if it drops from the catalog during a connection.
          selected = updated || (canSwitchDevice(state)
            ? null : Object.freeze({ ...selected, availability: 'unknown' }));
        }
        return true;
      }, () => { problem = '设备列表刷新失败。'; });
    }

    function select(id) {
      if (!snapshot().can.choose) return false;
      const device = catalog?.devices.find(item => item.id === id);
      if (!device) return false;
      selected = device;
      state = 'DISCONNECTED';
      feeNotice = problem = '';
      return true;
    }

    function operation(method, action, transition, expected) {
      if (!snapshot().can[action]) return false;
      const id = selected.id;
      if (transition) state = transition;
      feeNotice = '';
      function unknown() {
        state = 'UNKNOWN';
        problem = '设备状态无法确认，请先核查状态或前往官方 App。';
      }
      return request(owner => adapter[method](owner, id), reply => {
        if (reply?.deviceId === id && reply.state === 'ERROR') {
          state = 'ERROR';
          problem = '服务方明确拒绝了操作，请核查设备状态。';
          return false;
        }
        if (reply?.deviceId !== id || !expected.has(reply.state)) {
          unknown();
          return false;
        }
        state = reply.state;
        if (state === 'READY' && typeof reply.feeNotice === 'string') feeNotice = reply.feeNotice.trim();
        return true;
      }, unknown);
    }

    return {
      snapshot, refresh, select,
      connect: () => operation('connect', 'connect', 'CONNECTING', new Set(['READY'])),
      check: () => operation('readStatus', 'check', null, confirmedStates),
      disconnect: () => operation('disconnect', 'disconnect', null, new Set(['DISCONNECTED'])),
      start: confirmed => confirmed === true && operation('start', 'start', 'STARTING', new Set(['RUNNING'])),
      stop: () => operation('stop', 'stop', 'STOPPING', new Set(['FINISHED']))
    };
  }

  window.ZhuliDevices = { create };
})();
