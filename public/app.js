import { registry } from './widgets/registry.js';
import { createGrid } from './grid.js';

var container = document.getElementById('grid');
var errorEl = document.getElementById('app-error');
var DEFAULT_CONFIG = { weather: { unit: 'C' }, clock: {} };

function request(method, url, body) {
  return fetch(url, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    if (res.status === 401) { location.assign('/login'); throw new Error('Not authenticated'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

var state = { widgets: [], layouts: { lg: [], md: [], sm: [] } };
var grid = createGrid(container, registry, {
  updateConfig: function (id, config) {
    return request('PATCH', '/api/widgets/' + id, { config: config }).then(function (w) {
      // Keep local state in sync without re-rendering (the widget already shows the change).
      state.widgets.forEach(function (x) { if (x.id === id) x.config = w.config; });
      return w;
    });
  }
}, function (widget) {
  request('DELETE', '/api/widgets/' + widget.id).then(function () {
    state.widgets = state.widgets.filter(function (w) { return w.id !== widget.id; });
    Object.keys(state.layouts).forEach(function (bp) {
      state.layouts[bp] = state.layouts[bp].filter(function (id) { return id !== widget.id; });
    });
    grid.setState(state);
    showError('');
  }).catch(function () { showError('Could not remove the widget.'); });
});

function add(type) {
  request('POST', '/api/widgets', { type: type, config: DEFAULT_CONFIG[type] }).then(function (w) {
    state.widgets.push(w);
    Object.keys(state.layouts).forEach(function (bp) { state.layouts[bp].push(w.id); });
    grid.setState(state);
    showError('');
  }).catch(function () { showError('Could not add the widget.'); });
}

document.querySelectorAll('[data-add]').forEach(function (btn) {
  btn.addEventListener('click', function () { add(btn.dataset.add); });
});

request('GET', '/api/state').then(function (s) {
  state = s;
  grid.setState(state);
}).catch(function () { showError('Could not load your widgets.'); });
