// Clock widget: local time, ticking once per second until destroy().

// hour12 true/false forces 12/24h; anything else follows the browser locale.
export function formatTime(date, hour12) {
  var opts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  if (typeof hour12 === 'boolean') opts.hour12 = hour12;
  return date.toLocaleTimeString([], opts);
}

export function formatDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function render(el, config) {
  var hour12 = config && typeof config.hour12 === 'boolean' ? config.hour12 : undefined;
  var root = document.createElement('div');
  root.className = 'clock';
  root.innerHTML = '<p class="clock-time"></p><p class="clock-date"></p>';
  el.append(root);
  var time = root.querySelector('.clock-time');
  var date = root.querySelector('.clock-date');

  function tick() {
    var now = new Date();
    time.textContent = formatTime(now, hour12);
    date.textContent = formatDate(now);
  }
  tick();
  var timer = setInterval(tick, 1000);

  return { destroy: function () { clearInterval(timer); } };
}
