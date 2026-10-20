(function () {
  'use strict';
  var caps = __CAPABILITIES__;
  var appOrigin = __APP_ORIGIN__;
  var api = {};
  var theme = { mode: 'light', vars: {} };
  var listeners = [];

  function post(message) {
    message.dokudocs = 1;
    window.parent.postMessage(message, appOrigin);
  }

  if (caps.indexOf('theme') !== -1) {
    api.theme = {
      get: function () { return { mode: theme.mode, vars: Object.assign({}, theme.vars) }; },
      onChange: function (callback) { if (typeof callback === 'function') listeners.push(callback); }
    };
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== window.parent || !data || data.dokudocs !== 'theme') return;
      theme = { mode: data.mode === 'dark' ? 'dark' : 'light', vars: {} };
      var root = document.documentElement;
      root.setAttribute('data-theme', theme.mode);
      root.style.colorScheme = theme.mode;
      Object.keys(data.vars || {}).forEach(function (name) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof data.vars[name] === 'string') {
          root.style.setProperty(name, data.vars[name]);
          theme.vars[name] = data.vars[name];
        }
      });
      listeners.forEach(function (callback) { try { callback(api.theme.get()); } catch (e) { /* the page's own error */ } });
    });
  }

  if (caps.indexOf('download') !== -1) {
    // The viewer only saves a file while the person's click or key press is recent.
    api.download = function (name, content, type) {
      post({ type: 'download', name: String(name), mime: String(type || 'text/plain'), content: String(content) });
    };
  }

  Object.defineProperty(window, 'dokudocs', { value: Object.freeze(api), enumerable: false });
  post({ type: 'ready' });
})();
