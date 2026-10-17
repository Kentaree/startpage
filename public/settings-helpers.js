// Pure helpers for the Settings page.

export function typeLabel(registry, type) {
  return registry[type] && registry[type].label ? registry[type].label : String(type);
}

export function switchText(enabled) {
  return enabled ? 'On' : 'Off';
}

// Small caption next to the title, e.g. "weather widget" or "rss widget · hidden from start page".
export function typeCaption(widget) {
  var base = widget.type + ' widget';
  return widget.enabled === false ? base + ' · hidden from start page' : base;
}

export function removeTitle(label) {
  return 'Remove this ' + label + ' widget?';
}

export function toggleMessage(ok, enabled) {
  return ok ? 'Saved' : 'Could not save' + (enabled ? ' — the widget stays off.' : ' — the widget stays on.');
}

export function withoutWidget(widgets, id) {
  return widgets.filter(function (w) { return w.id !== id; });
}
