import { describe, expect, it } from 'vitest';
import { assignColumns, breakpointForWidth, columnCount, orderWidgets } from '../public/grid.js';
import {
  buildUrl, celsiusToFahrenheit, formatTemperature, normalizeUnit, roundCoord, weatherLabel
} from '../public/widgets/weather.js';
import { formatTime } from '../public/widgets/clock.js';

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

describe('weather helpers', () => {
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
