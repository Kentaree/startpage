// Each widget type exposes render(el, config, api) which may return { destroy() }
// for instance-scoped cleanup. api.updateConfig(config) persists a config change.
// api.id is the widget id.
import * as weather from './weather.js';
import * as clock from './clock.js';
import * as rss from './rss.js';

export const registry = {
  weather: { label: 'Weather', render: weather.render },
  clock: { label: 'Clock', render: clock.render },
  rss: { label: 'RSS', render: rss.render }
};
