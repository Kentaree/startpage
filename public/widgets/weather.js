// Weather widget (Open-Meteo). Supports multiple instances: all DOM access is scoped to the root passed to render().

var DEFAULT_LOCATION = { name: 'Dublin, Ireland', lat: 53.3498, lon: -6.2603 };
var LEGACY_UNIT_KEY = 'startpage.weather.unit';
var FETCH_TIMEOUT_MS = 8000;
var GEO_TIMEOUT_MS = 8000;


export function weatherLabel(code) {
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

export function celsiusToFahrenheit(c) {
  return c * 9 / 5 + 32;
}

export function formatTemperature(celsius, unit) {
  var value = unit === 'F' ? celsiusToFahrenheit(celsius) : celsius;
  return Math.round(value) + '°' + (unit === 'F' ? 'F' : 'C');
}

export function roundCoord(n) {
  return Math.round(n * 100) / 100;
}

export function buildUrl(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + roundCoord(lat) +
    '&longitude=' + roundCoord(lon) + '&current=temperature_2m,weather_code';
}

// A saved city ({name, lat, lon}) from the widget config, or null when absent/malformed.
export function cityFromConfig(config) {
  var c = config && config.city;
  if (!c || typeof c.name !== 'string' || !c.name) return null;
  if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return null;
  if (!isFinite(c.lat) || !isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) return null;
  return { name: c.name, lat: roundCoord(c.lat), lon: roundCoord(c.lon) };
}

// Full config to save: the PUT replaces the whole config, so keep the saved city alongside the unit.
export function buildWeatherConfig(unit, city) {
  var cfg = { unit: normalizeUnit(unit) };
  if (city) cfg.city = { name: city.name, lat: city.lat, lon: city.lon };
  return cfg;
}

export function normalizeUnit(u) {
  return typeof u === 'string' && u.toUpperCase() === 'F' ? 'F' : 'C';
}


// The unit used to live in localStorage; use it once as a fallback, then drop it.
function takeLegacyUnit() {
  try {
    var v = localStorage.getItem(LEGACY_UNIT_KEY);
    if (v === null) return null;
    localStorage.removeItem(LEGACY_UNIT_KEY);
    return normalizeUnit(v);
  } catch (e) { return null; }
}

export function render(el, config, api) {
  var root = document.createElement('div');
  root.className = 'weather';
  root.setAttribute('aria-live', 'polite');
  root.innerHTML =
    '<h2 class="weather-place"></h2>' +
    '<p class="weather-status">Loading weather…</p>' +
    '<p class="weather-reading" hidden><span class="weather-temp"></span> <span class="weather-conditions"></span></p>' +
    '<button type="button" class="weather-retry app-btn" hidden>Retry</button> ' +
    '<button type="button" class="weather-unit app-btn" aria-label="Switch temperature unit">°F</button>';
  el.append(root);
  var q = function (sel) { return root.querySelector(sel); };
  var els = {
    place: q('.weather-place'),
    status: q('.weather-status'),
    reading: q('.weather-reading'),
    temp: q('.weather-temp'),
    conditions: q('.weather-conditions'),
    retry: q('.weather-retry'),
    unit: q('.weather-unit')
  };

  var legacy = takeLegacyUnit();
  var savedCity = cityFromConfig(config);
  var state = {
    unit: normalizeUnit(legacy || (config && config.unit)),
    place: savedCity ? savedCity.name : DEFAULT_LOCATION.name, celsius: null, code: null
  };
  var destroyed = false;
  var requestToken = 0;
  var currentController = null;
  var fetchTimer = null;
  var current = DEFAULT_LOCATION;

  function saveUnit() {
    if (api && api.updateConfig) {
      Promise.resolve(api.updateConfig(buildWeatherConfig(state.unit, savedCity))).catch(function () { /* keep local state */ });
    }
  }

  function draw() {
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
    draw();
  }

  function load(loc) {
    var token = ++requestToken;
    if (currentController) currentController.abort();
    clearTimeout(fetchTimer);
    var controller = new AbortController();
    currentController = controller;
    fetchTimer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
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
      .then(function () { if (token === requestToken) clearTimeout(fetchTimer); });
  }

  els.unit.addEventListener('click', function () {
    state.unit = state.unit === 'C' ? 'F' : 'C';
    saveUnit();
    draw();
  });

  els.retry.addEventListener('click', function () { load(current); });

  draw();
  if (legacy !== null && (!config || normalizeUnit(config.unit) !== legacy)) saveUnit();

  if (savedCity) {
    load(savedCity);
  } else {
    load(DEFAULT_LOCATION);
  }
  if (!savedCity && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (destroyed) return;
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

  return {
    destroy: function () {
      destroyed = true;
      requestToken++;
      clearTimeout(fetchTimer);
      if (currentController) currentController.abort();
    }
  };
}
