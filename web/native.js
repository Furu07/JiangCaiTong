/* Requests from the bundled assets are completed by NativeBridge on the WebView thread. */
(function () {
  'use strict';
  let sequence = 0;
  const pending = new Map();

  window.__nativeDone = function (id, json) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    try {
      request.resolve(JSON.parse(json));
    } catch (error) {
      request.reject(new Error('无法读取 Android 桥接响应'));
    }
  };

  window.nativeRequest = function (method, url, body, referer, headers, studyScope, waterAttempt) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try {
        Android.req2(id, method, url, body || '', referer || '',
                     headers ? JSON.stringify(headers) : '', studyScope || '', waterAttempt || '');
      } catch (error) {
        pending.delete(id);
        reject(new Error('无法调用 Android 网络服务'));
      }
    });
  };
})();
