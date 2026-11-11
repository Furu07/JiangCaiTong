/* The verified integration is an external app entry. Authorization stays with Zhuli. */
(function () {
  'use strict';

  function create(bridge) {
    const supported = typeof bridge?.zhuliAppAvailable === 'function'
      && typeof bridge?.openOfficialZhuli === 'function';

    function status() {
      if (!supported) return 'unavailable';
      try {
        return bridge.zhuliAppAvailable() ? 'external-app' : 'external-store';
      } catch (error) {
        return 'unavailable';
      }
    }

    function open() {
      if (!supported) return false;
      try {
        bridge.openOfficialZhuli();
        return true;
      } catch (error) {
        return false;
      }
    }

    return { status, open };
  }

  window.Zhuli = { create };
})();
