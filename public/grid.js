// Grid layout: pure ordering/column functions plus the DOM renderer.

export const BREAKPOINTS = ['lg', 'md', 'sm'];
export const QUERIES = { lg: '(min-width: 1024px)', md: '(min-width: 640px)' };
const COLUMNS = { lg: 3, md: 2, sm: 1 };

export function breakpointForWidth(width) {
  if (width >= 1024) return 'lg';
  if (width >= 640) return 'md';
  return 'sm';
}

export function columnCount(bp) {
  return COLUMNS[bp] || 1;
}

// Widgets sorted by the breakpoint's id order; unknown ids are ignored and
// widgets missing from the order are appended.
export function orderWidgets(widgets, order) {
  var byId = new Map(widgets.map(function (w) { return [w.id, w]; }));
  var out = [];
  (order || []).forEach(function (id) {
    if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); }
  });
  byId.forEach(function (w) { out.push(w); });
  return out;
}

// Zero-based column for each position when items flow left-to-right across `cols` columns.
export function assignColumns(count, cols) {
  var out = [];
  for (var i = 0; i < count; i++) out.push(i % cols);
  return out;
}

// Move the item at `from` so it ends up at index `to`; returns a new array.
export function moveItem(order, from, to) {
  if (from < 0 || from >= order.length) return order.slice();
  var t = Math.max(0, Math.min(order.length - 1, to));
  var out = order.slice();
  var item = out.splice(from, 1)[0];
  out.splice(t, 0, item);
  return out;
}

// Move the id one step earlier (-1) or later (+1); returns a new array.
export function moveById(order, id, delta) {
  var i = order.indexOf(id);
  return i < 0 ? order.slice() : moveItem(order, i, i + delta);
}

// Index of the rect a pointer is over, else the nearest rect centre. -1 if no rects.
export function dropIndex(rects, x, y) {
  var best = -1, bestDist = Infinity;
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    var dx = (r.left + r.right) / 2 - x, dy = (r.top + r.bottom) / 2 - y;
    var d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

export var SAVE_ERROR = "Couldn't save your layout. Check your connection and try again.";

// api.saveLayout(bp, order) -> Promise; onError(message) reports user-facing errors.
export function createGrid(container, registry, api, onRemove, onError) {
  var mounted = [];
  var state = { widgets: [], layouts: { lg: [], md: [], sm: [] } };
  var mqLg = window.matchMedia(QUERIES.lg);
  var mqMd = window.matchMedia(QUERIES.md);
  var current = currentBreakpoint();
  var cards = new Map();
  var confirmed = {};   // last server-acknowledged order per breakpoint
  var saves = {};       // per breakpoint: { inFlight, dirty }
  var live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  container.after(live);
  var drag = null;

  function currentBreakpoint() {
    return mqLg.matches ? 'lg' : mqMd.matches ? 'md' : 'sm';
  }

  function unmountAll() {
    mounted.forEach(function (m) { if (m.instance && m.instance.destroy) m.instance.destroy(); });
    mounted = [];
    cards = new Map();
    container.textContent = '';
  }

  function render() {
    unmountAll();
    container.dataset.breakpoint = current;
    orderWidgets(state.widgets, state.layouts[current]).forEach(function (w) {
      var def = registry[w.type];
      if (!def) return;
      var card = document.createElement('section');
      card.className = 'widget widget-' + w.type;
      var body = document.createElement('div');
      body.className = 'widget-body';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'widget-remove app-btn';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + w.type + ' widget');
      remove.addEventListener('click', function () { onRemove(w); });
      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'widget-handle app-btn';
      handle.textContent = '⋮⋮';
      handle.setAttribute('aria-label', 'Move ' + w.type + ' widget. Drag, or use arrow keys to reorder.');
      handle.addEventListener('pointerdown', function (e) { startDrag(e, w.id, card); });
      handle.addEventListener('keydown', function (e) { onKey(e, w.id); });
      card.append(handle, remove, body);
      cards.set(w.id, { card: card, handle: handle });
      container.append(card);
      var instance = def.render(body, w.config, {
        id: w.id,
        updateConfig: function (config) { return api.updateConfig(w.id, config); }
      });
      mounted.push({ id: w.id, instance: instance || def });
    });
  }

  function currentOrder() {
    return orderWidgets(state.widgets, state.layouts[current]).map(function (w) { return w.id; });
  }

  function applyOrder() {
    currentOrder().forEach(function (id) {
      var c = cards.get(id);
      if (c) container.append(c.card);
    });
  }

  function typeOf(id) {
    var w = state.widgets.filter(function (x) { return x.id === id; })[0];
    return w ? w.type : 'widget';
  }

  // Optimistic update, then save (serialised per breakpoint; last write wins).
  function commit(next, announceId) {
    var bp = current;
    var prev = currentOrder();
    if (next.join() === prev.join()) return;
    if (!confirmed[bp]) confirmed[bp] = prev;
    state.layouts[bp] = next;
    applyOrder();
    if (announceId !== undefined) {
      live.textContent = 'Moved ' + typeOf(announceId) + ' widget to position ' +
        (next.indexOf(announceId) + 1) + ' of ' + next.length + '.';
      var c = cards.get(announceId);
      if (c) c.handle.focus();
    }
    save(bp);
  }

  function save(bp) {
    var s = saves[bp] || (saves[bp] = { inFlight: false, dirty: false });
    if (s.inFlight) { s.dirty = true; return; }
    s.inFlight = true;
    var sent = state.layouts[bp].slice();
    Promise.resolve(api.saveLayout(bp, sent)).then(function () {
      confirmed[bp] = sent;
      s.inFlight = false;
      if (s.dirty) { s.dirty = false; save(bp); }
    }, function () {
      s.inFlight = false;
      s.dirty = false;
      state.layouts[bp] = confirmed[bp].slice();
      if (bp === current) applyOrder();
      if (onError) onError(SAVE_ERROR);
      live.textContent = SAVE_ERROR;
    });
  }

  function onKey(e, id) {
    var delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    var order = currentOrder();
    var next = moveById(order, id, delta);
    if (next.join() === order.join()) {
      live.textContent = typeOf(id) + ' widget is already ' + (delta < 0 ? 'first' : 'last') + '.';
      return;
    }
    commit(next, id);
  }

  function cardRects(order) {
    return order.map(function (id) { return cards.get(id).card.getBoundingClientRect(); });
  }

  function clearTarget() {
    cards.forEach(function (c) { c.card.classList.remove('drop-target'); });
  }

  function startDrag(e, id, card) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    var order = currentOrder();
    drag = { id: id, from: order.indexOf(id), to: order.indexOf(id), pointerId: e.pointerId };
    card.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var order = currentOrder();
    var to = dropIndex(cardRects(order), e.clientX, e.clientY);
    if (to < 0) return;
    drag.to = to;
    clearTarget();
    if (to !== drag.from) cards.get(order[to]).card.classList.add('drop-target');
  }

  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    clearTarget();
    var c = cards.get(drag.id);
    if (c) c.card.classList.remove('dragging');
    var d = drag;
    drag = null;
    return d;
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = endDrag();
    commit(moveItem(currentOrder(), d.from, d.to), d.id);
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag();
  }

  function onChange() {
    var next = currentBreakpoint();
    if (next !== current) { current = next; render(); }
  }
  mqLg.addEventListener('change', onChange);
  mqMd.addEventListener('change', onChange);

  return {
    setState: function (s) { state = s; render(); }
  };
}
