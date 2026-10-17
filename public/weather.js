(function () {
  'use strict';

  var DEFAULT_LOCATION = { name: 'Dublin, Ireland', lat: 53.3498, lon: -6.2603 };
  var UNIT_KEY = 'startpage.weather.unit';
  var FETCH_TIMEOUT_MS = 8000;
  var GEO_TIMEOUT_MS = 8000;

  // ---- Pure helpers ----

  function weatherLabel(code) {
    var table = [
      [[0], 'Clear sky'],
      [[1, 2], 'Partly cloudy'],
      [[3], 'Overcast'],
      [[45, 48], 'Fog'],
      [[51, 52, 53, 54, 55, 56, 57], 'Drizzle'],
      [[61, 62, 63, 64, 65, 66, 67], 'Rain'],
      [[71, 72, 73, 74, 75, 76, 77], 'Snow'],
      [[80, 81, 82], 'Showers'],
      [[85, 86], 'Snow showers'],
      [[95, 96, 97, 98, 99], 'Thunderstorm']
    ];
    for (var i = 0; i < table.length; i++) {
      if (table[i][0].indexOf(code) !== -1) return table[i][1];
    }
    return 'Unknown';
  }

  function celsiusToFahrenheit(c) {
    return c * 9 / 5 + 32;
  }

  function formatTemperature(celsius, unit) {
    var value = unit === 'F' ? celsiusToFahrenheit(celsius) : celsius;
    return Math.round(value) + '°' + (unit === 'F' ? 'F' : 'C');
  }

  function roundCoord(n) {
    return Math.round(n * 100) / 100;
  }

  function buildUrl(lat, lon) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + roundCoord(lat) +
      '&longitude=' + roundCoord(lon) + '&current=temperature_2m,weather_code';
  }

  function normalizeUnit(u) {
    return u === 'F' ? 'F' : 'C';
  }

  // ---- Storage ----

  function loadUnit() {
    try { return normalizeUnit(localStorage.getItem(UNIT_KEY)); } catch (e) { return 'C'; }
  }

  function saveUnit(unit) {
    try { localStorage.setItem(UNIT_KEY, unit); } catch (e) { /* storage blocked */ }
  }

  // ---- DOM ----

  var root = document.getElementById('weather');
  if (!root) return;
  var els = {
    place: document.getElementById('weather-place'),
    status: document.getElementById('weather-status'),
    reading: document.getElementById('weather-reading'),
    temp: document.getElementById('weather-temp'),
    conditions: document.getElementById('weather-conditions'),
    retry: document.getElementById('weather-retry'),
    unit: document.getElementById('weather-unit')
  };

  var state = { unit: loadUnit(), place: DEFAULT_LOCATION.name, celsius: null, code: null };
  var requestToken = 0;
  var currentController = null;
  var current = { name: DEFAULT_LOCATION.name, lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon };
  var locationResolved = false;

  function render() {
    els.place.textContent = state.place;
    els.unit.textContent = state.unit === 'C' ? '°F' : '°C';
    els.unit.setAttribute('aria-label', 'Switch to ' + (state.unit === 'C' ? 'Fahrenheit' : 'Celsius'));
    if (state.celsius !== null) {
      els.temp.textContent = formatTemperature(state.celsius, state.unit);
      els.conditions.textContent = weatherLabel(state.code);
    }
  }

  function showLoading() {
    els.status.hidden = false;
    els.status.textContent = 'Loading weather…';
    els.reading.hidden = true;
    els.retry.hidden = true;
  }

  function showError() {
    els.status.hidden = false;
    els.status.textContent = 'Weather unavailable';
    els.reading.hidden = true;
    els.retry.hidden = false;
  }

  function showData() {
    els.status.hidden = true;
    els.reading.hidden = false;
    els.retry.hidden = true;
    render();
  }

  function load(loc) {
    var token = ++requestToken;
    if (currentController) currentController.abort();
    var controller = new AbortController();
    currentController = controller;
    var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    current = loc;
    state.place = loc.name;
    state.celsius = null;
    els.place.textContent = loc.name;
    showLoading();

    fetch(buildUrl(loc.lat, loc.lon), { signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (token !== requestToken) return;
        var cur = data && data.current;
        if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('Bad data');
        state.celsius = cur.temperature_2m;
        state.code = cur.weather_code;
        showData();
      })
      .catch(function () {
        if (token !== requestToken) return;
        showError();
      })
      .then(function () { clearTimeout(timer); });
  }

  els.unit.addEventListener('click', function () {
    state.unit = state.unit === 'C' ? 'F' : 'C';
    saveUnit(state.unit);
    render();
  });

  els.retry.addEventListener('click', function () { load(current); });

  function start() {
    load(DEFAULT_LOCATION);
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        locationResolved = true;
        load({
          name: 'Your location',
          lat: roundCoord(pos.coords.latitude),
          lon: roundCoord(pos.coords.longitude)
        });
      },
      function () { /* denied or timed out: keep Dublin */ },
      { timeout: GEO_TIMEOUT_MS }
    );
  }

  start();
})();
