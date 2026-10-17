import { registry } from './widgets/registry.js';
import { typeLabel, toggleMessage, switchText, typeCaption, removeTitle, withoutWidget } from './settings-helpers.js';

var cardsEl = document.getElementById('cards');
var emptyEl = document.getElementById('empty');
var errorEl = document.getElementById('app-error');
var statusEl = document.getElementById('status');
var dialog = document.getElementById('confirm');
var widgets = [];
var pendingRemove = null;
var opener = null;

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

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', !!isError);
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCard(w) {
  var label = typeLabel(registry, w.type);
  var card = el('section', 'card ' + (w.enabled === false ? 'off' : 'on'));
  card.dataset.id = w.id;
  var head = el('div', 'head');
  var h2 = el('h2', null, label + ' ');
  var caption = el('span', 'type', '· ' + typeCaption(w));
  h2.appendChild(caption);
  var sw = el('label', 'switch');
  var text = el('span', null, switchText(w.enabled !== false));
  var input = el('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = w.enabled !== false;
  input.setAttribute('aria-checked', String(input.checked));
  input.setAttribute('aria-label', label + ' widget');
  sw.append(text, input, el('span', 'track'));
  head.append(h2, sw);
  card.appendChild(head);

  // Per-type options go here: the follow-up task implements registry[type].settings.
  var opts = el('div', 'opts');
  card.appendChild(opts);
  var hook = registry[w.type] && registry[w.type].settings;
  if (typeof hook === 'function') {
    hook(opts, w.config, function (config) {
      return request('PATCH', '/api/widgets/' + w.id, { config: config }).then(function (u) { w.config = u.config; return u; });
    });
  }

  var actions = el('div', 'card-actions');
  var rm = el('button', 'app-btn danger', 'Remove this widget…');
  rm.type = 'button';
  rm.addEventListener('click', function () { openConfirm(w, rm); });
  actions.appendChild(rm);
  card.appendChild(actions);

  function apply(enabled) {
    input.checked = enabled;
    input.setAttribute('aria-checked', String(enabled));
    text.textContent = switchText(enabled);
    card.classList.toggle('on', enabled);
    card.classList.toggle('off', !enabled);
    caption.textContent = '· ' + typeCaption({ type: w.type, enabled: enabled });
  }
  input.addEventListener('change', function () {
    var want = input.checked;
    apply(want);
    request('PATCH', '/api/widgets/' + w.id, { enabled: want }).then(function () {
      w.enabled = want;
      setStatus(toggleMessage(true, want));
    }).catch(function () {
      apply(w.enabled !== false);
      setStatus(toggleMessage(false, want), true);
    });
  });
  return card;
}

function render() {
  cardsEl.textContent = '';
  widgets.forEach(function (w) { cardsEl.appendChild(renderCard(w)); });
  emptyEl.hidden = widgets.length > 0;
}

function openConfirm(w, button) {
  pendingRemove = w;
  opener = button;
  document.getElementById('confirm-title').textContent = removeTitle(typeLabel(registry, w.type));
  dialog.showModal();
  document.getElementById('confirm-cancel').focus();
}

document.getElementById('confirm-cancel').addEventListener('click', function () { dialog.close(); });
dialog.addEventListener('close', function () {
  // Escape and Cancel both land here; return focus to the Remove button that opened it.
  if (!pendingRemove && opener && opener.isConnected) opener.focus();
});
dialog.addEventListener('cancel', function () { pendingRemove = null; });
document.getElementById('confirm-cancel').addEventListener('click', function () { pendingRemove = null; });

document.getElementById('confirm-ok').addEventListener('click', function () {
  var w = pendingRemove;
  pendingRemove = null;
  dialog.close();
  if (!w) return;
  request('DELETE', '/api/widgets/' + w.id).then(function () {
    widgets = withoutWidget(widgets, w.id);
    render();
    setStatus('Widget removed');
    var target = cardsEl.querySelector('.card-actions button') || document.querySelector('.toolbar a');
    if (widgets.length === 0) target = emptyEl.querySelector('a');
    target.focus();
  }).catch(function () {
    setStatus('Could not remove the widget.', true);
    if (opener && opener.isConnected) opener.focus();
  });
});

request('GET', '/api/state').then(function (s) {
  widgets = s.widgets || [];
  render();
}).catch(function () {
  errorEl.textContent = 'Could not load your widgets.';
  errorEl.hidden = false;
});
