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

export function createGrid(container, registry, api, onRemove) {
  var mounted = [];
  var state = { widgets: [], layouts: { lg: [], md: [], sm: [] } };
  var mqLg = window.matchMedia(QUERIES.lg);
  var mqMd = window.matchMedia(QUERIES.md);
  var current = currentBreakpoint();

  function currentBreakpoint() {
    return mqLg.matches ? 'lg' : mqMd.matches ? 'md' : 'sm';
  }

  function unmountAll() {
    mounted.forEach(function (m) { if (m.instance && m.instance.destroy) m.instance.destroy(); });
    mounted = [];
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
      card.append(remove, body);
      container.append(card);
      var instance = def.render(body, w.config, {
        updateConfig: function (config) { return api.updateConfig(w.id, config); }
      });
      mounted.push({ id: w.id, instance: instance || def });
    });
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
