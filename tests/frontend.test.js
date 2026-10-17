import { describe, expect, it } from 'vitest';
import { assignColumns, breakpointForWidth, columnCount, dropIndex, moveById, isEnabled, mergeVisibleOrder, moveItem, orderWidgets } from '../public/grid.js';
import {
  buildWeatherConfig, buildUrl, celsiusToFahrenheit, cityFromConfig, formatTemperature, normalizeUnit, roundCoord, weatherLabel
} from '../public/widgets/weather.js';
import { buildConfig, feedUrlsFromConfig, formatMeta, safeLink } from '../public/widgets/rss.js';
import { formatVersion } from '../public/version.js';
import { formatTime } from '../public/widgets/clock.js';

describe('grid enabled state', () => {
  it('treats missing enabled as on', () => {
    expect(isEnabled({ id: 1 })).toBe(true);
    expect(isEnabled({ id: 1, enabled: false })).toBe(false);
  });
  it('keeps hidden ids in the full order when reordering visible ones', () => {
    expect(mergeVisibleOrder([1, 2, 3, 4], [4, 3, 1])).toEqual([4, 2, 3, 1]);
    expect(mergeVisibleOrder([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe('grid', () => {
  it('maps widths to breakpoints and columns', () => {
    expect(breakpointForWidth(1024)).toBe('lg');
    expect(breakpointForWidth(1023)).toBe('md');
    expect(breakpointForWidth(640)).toBe('md');
    expect(breakpointForWidth(639)).toBe('sm');
    expect([columnCount('lg'), columnCount('md'), columnCount('sm')]).toEqual([3, 2, 1]);
  });
  it('orders widgets, ignoring unknown ids and appending missing ones', () => {
    const w = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(orderWidgets(w, [3, 9, 1]).map((x) => x.id)).toEqual([3, 1, 2]);
    expect(orderWidgets(w, undefined).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(orderWidgets(w, [2, 2]).map((x) => x.id)).toEqual([2, 1, 3]);
  });
  it('assigns columns left to right', () => {
    expect(assignColumns(5, 3)).toEqual([0, 1, 2, 0, 1]);
    expect(assignColumns(3, 1)).toEqual([0, 0, 0]);
    expect(assignColumns(0, 2)).toEqual([]);
  });
});

describe('reorder', () => {
  it('moves items without mutating', () => {
    const o = [1, 2, 3, 4];
    expect(moveItem(o, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(o, 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem(o, 1, 1)).toEqual([1, 2, 3, 4]);
    expect(moveItem(o, 1, 99)).toEqual([1, 3, 4, 2]);
    expect(moveItem(o, 9, 0)).toEqual([1, 2, 3, 4]);
    expect(o).toEqual([1, 2, 3, 4]);
  });
  it('moves by id one step, clamped at the ends', () => {
    expect(moveById([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveById([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveById([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveById([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(moveById([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
  it('finds the drop index from pointer position', () => {
    const r = (l, t) => ({ left: l, top: t, right: l + 100, bottom: t + 100 });
    const rects = [r(0, 0), r(110, 0), r(0, 110)];
    expect(dropIndex(rects, 150, 50)).toBe(1);
    expect(dropIndex(rects, 50, 160)).toBe(2);
    expect(dropIndex(rects, 105, 105)).toBe(0); // in a gap: nearest centre
    expect(dropIndex([], 0, 0)).toBe(-1);
  });
});

describe('weather helpers', () => {
  it('buildWeatherConfig keeps the saved city with the unit', () => {
    const city = { name: 'Lisbon, Portugal', lat: 38.72, lon: -9.14 };
    expect(buildWeatherConfig('F', city)).toEqual({ unit: 'F', city });
    expect(buildWeatherConfig('f', null)).toEqual({ unit: 'F' });
    expect(buildWeatherConfig('x')).toEqual({ unit: 'C' });
  });

  it('labels codes', () => {
    expect(weatherLabel(0)).toBe('Clear sky');
    expect(weatherLabel(63)).toBe('Rain');
    expect(weatherLabel(1234)).toBe('Unknown');
  });
  it('converts and formats temperature', () => {
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(formatTemperature(20.4, 'C')).toBe('20°C');
    expect(formatTemperature(20, 'F')).toBe('68°F');
    expect(formatTemperature(-0.4, 'C')).toBe('0°C');
  });
  it('rounds coordinates and builds the URL', () => {
    expect(roundCoord(53.34981)).toBe(53.35);
    expect(buildUrl(53.3498, -6.2603)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=53.35&longitude=-6.26&current=temperature_2m,weather_code'
    );
  });
  it('normalizes units', () => {
    expect(normalizeUnit('F')).toBe('F');
    expect(normalizeUnit('f')).toBe('F');
    expect(normalizeUnit('c')).toBe('C');
    expect(normalizeUnit(null)).toBe('C');
  });
});

describe('clock', () => {
  it('formats time', () => {
    expect(formatTime(new Date(2024, 0, 1, 13, 5, 9))).toMatch(/05/);
  });
});

describe('rss helpers', () => {
  it('only allows http(s) links', () => {
    expect(safeLink('https://e.com/a')).toBe('https://e.com/a');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('nope')).toBeNull();
  });
});

describe('version footer', () => {
  it('formats the version', () => {
    expect(formatVersion('0.1.0', 2026)).toBe('startpage v0.1.0 \u00b7 2026');
  });

  it('defaults to the current year', () => {
    expect(formatVersion('0.1.0')).toBe('startpage v0.1.0 \u00b7 ' + new Date().getFullYear());
  });
});

import { typeLabel, switchText, typeCaption, removeTitle, toggleMessage, withoutWidget } from '../public/settings-helpers.js';

describe('settings helpers', () => {
  it('labels types, falling back to the raw type', () => {
    expect(typeLabel({ rss: { label: 'RSS' } }, 'rss')).toBe('RSS');
    expect(typeLabel({}, 'foo')).toBe('foo');
  });
  it('describes state', () => {
    expect(switchText(true)).toBe('On');
    expect(switchText(false)).toBe('Off');
    expect(typeCaption({ type: 'rss', enabled: false })).toBe('rss widget · hidden from start page');
    expect(typeCaption({ type: 'clock' })).toBe('clock widget');
    expect(removeTitle('RSS')).toBe('Remove this RSS widget?');
    expect(toggleMessage(true, true)).toBe('Saved');
    expect(toggleMessage(false, true)).toMatch(/^Could not save/);
  });
  it('removes a widget by id without mutating', () => {
    const w = [{ id: 1 }, { id: 2 }];
    expect(withoutWidget(w, 1)).toEqual([{ id: 2 }]);
    expect(w).toHaveLength(2);
  });
});

describe('richer widget options', () => {
  it('reads a saved weather city', () => {
    expect(cityFromConfig({ city: { name: 'Lisbon', lat: 38.7223, lon: -9.1393 } })).toEqual({ name: 'Lisbon', lat: 38.72, lon: -9.14 });
    expect(cityFromConfig({ unit: 'C' })).toBeNull();
    expect(cityFromConfig({ city: { name: 'X', lat: 99, lon: 0 } })).toBeNull();
    expect(cityFromConfig(null)).toBeNull();
  });
  it('clock honours hour12', () => {
    const d = new Date(2024, 0, 1, 19, 42, 5);
    expect(formatTime(d, false)).toMatch(/^19/);
    expect(formatTime(d, true)).toMatch(/^07/);
    expect(formatTime(d, true)).toMatch(/pm/i);
  });
  it('builds and reads rss configs', () => {
    expect(feedUrlsFromConfig({ feedUrl: 'https://a.com/f' })).toEqual(['https://a.com/f']);
    expect(feedUrlsFromConfig({ feedUrls: ['https://a.com/f', 'https://b.com/f'] })).toHaveLength(2);
    expect(feedUrlsFromConfig({})).toEqual([]);
    expect(buildConfig('https://a.com/f')).toEqual({ feedUrls: ['https://a.com/f'] });
    expect(formatMeta({ source: 'bbc.co.uk', date: null })).toBe('bbc.co.uk');
    expect(formatMeta({ title: 't' })).toBe('');
  });
});
