// Clock widget: local time, ticking once per second until destroy().

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function render(el) {
  var root = document.createElement('div');
  root.className = 'clock';
  root.innerHTML = '<p class="clock-time"></p><p class="clock-date"></p>';
  el.append(root);
  var time = root.querySelector('.clock-time');
  var date = root.querySelector('.clock-date');

  function tick() {
    var now = new Date();
    time.textContent = formatTime(now);
    date.textContent = formatDate(now);
  }
  tick();
  var timer = setInterval(tick, 1000);

  return { destroy: function () { clearInterval(timer); } };
}
