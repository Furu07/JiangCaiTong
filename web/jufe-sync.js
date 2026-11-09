/* Foreground-only scheduling for a verified JUFE adapter. */
(function () {
  'use strict';
  const storageKey = 'jct.jufe.binding.v1';
  const freshFor = 6 * 60 * 60 * 1000;
  const retryDelay = 30 * 1000;

  function create(adapter, storage, now = Date.now) {
    const repository = Academic.createRepository(adapter, storage, now);
    let binding = readBinding();
    let inflight = null;
    let lastAttempt = -Infinity;

    function readBinding() {
      try {
        const saved = JSON.parse(storage.getItem(storageKey));
        if (!saved || typeof saved.accountKey !== 'string' || !saved.accountKey || !Array.isArray(saved.terms)) return null;
        const terms = saved.terms.map(Academic.normalizeTerm);
        if (!terms.some(term => term.termId === saved.selected)) return null;
        return { accountKey: saved.accountKey, terms, selected: saved.selected, suspended: saved.suspended === true };
      } catch (error) {
        return null;
      }
    }

    function publish(next) {
      storage.setItem(storageKey, JSON.stringify(next));
      binding = next;
    }

    function snapshot() {
      const session = adapter.status();
      // An in-progress switch must never expose a different account's cached data.
      const visible = binding && !binding.suspended
        && (!session.accountKey || session.accountKey === binding.accountKey);
      return {
        terms: visible ? binding.terms : [],
        selected: visible ? binding.selected : '',
        entry: visible ? repository.readFor(binding.accountKey, binding.selected) : null,
        state: visible && session.state === 'authorized' ? 'authorized' : visible ? 'reauthorize' : 'unbound',
        syncing: !!inflight
      };
    }

    function start(key, action) {
      if (inflight) {
        if (inflight.key === key) return inflight.promise;
        return Promise.reject(new Error('已有课表同步正在运行'));
      }
      lastAttempt = now();
      const promise = Promise.resolve().then(action).finally(() => { inflight = null; });
      inflight = { key, promise };
      return promise;
    }

    function bind(candidate) {
      return start('bind:' + candidate.accountKey, async () => {
        if (binding && binding.accountKey !== candidate.accountKey && !binding.suspended) {
          // A failed switch must not expose the previous owner's data, even after reopening.
          publish({ ...binding, suspended: true });
        }
        adapter.authorize(candidate);
        const initial = adapter.status();
        try {
          const terms = await adapter.listTerms();
          const current = terms.filter(term => term.current);
          if (current.length !== 1) throw new Error('无法从已验证的响应确定当前学期');
          const selected = current[0].termId;
          const entry = await repository.sync(selected);
          const session = adapter.status();
          if (entry.status !== 'fresh' || !entry.cached || session.state !== 'authorized'
              || session.revision !== initial.revision) {
            throw entry.error || new Error('首次授权尚未验证本人课表');
          }
          publish({ accountKey: initial.accountKey, terms, selected });
          return entry;
        } catch (error) {
          if (adapter.status().revision === initial.revision) adapter.signOut();
          throw error;
        }
      });
    }

    function refresh(termId, manual = false) {
      const current = snapshot();
      const term = current.terms.find(item => item.termId === termId);
      if (!term || !binding) return Promise.reject(new Error('请选择已验证的学期'));
      const key = 'term:' + termId;
      if (inflight) {
        return inflight.key === key ? inflight.promise : Promise.reject(new Error('已有课表同步正在运行'));
      }
      const local = repository.readFor(binding.accountKey, termId);
      if (binding.selected !== termId) publish({ ...binding, selected: termId });
      if (current.state !== 'authorized') return Promise.resolve(local);
      if ((!manual && local && now() - local.syncedAt < freshFor) || now() - lastAttempt < retryDelay) {
        return Promise.resolve(local);
      }
      return start(key, () => repository.sync(termId));
    }

    function resume() {
      const current = snapshot();
      return current.selected && current.state === 'authorized'
        ? refresh(current.selected) : Promise.resolve(current.entry);
    }

    function restore(candidate) {
      if (!binding || binding.suspended || candidate.accountKey !== binding.accountKey) return bind(candidate);
      if (inflight) return Promise.reject(new Error('已有课表同步正在运行'));
      adapter.authorize(candidate);
      return resume();
    }

    return { bind, restore, snapshot, refresh, resume };
  }

  window.JufeSync = { create };
})();
