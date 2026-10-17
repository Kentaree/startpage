export function formatVersion(v, year) {
  if (year === undefined) year = new Date().getFullYear();
  return 'startpage v' + v + ' \u00b7 ' + year;
}

export function loadVersionFooter() {
  fetch('/api/version').then(function (r) {
    if (!r.ok) throw new Error('version');
    return r.json();
  }).then(function (d) {
    if (!d || typeof d.version !== 'string') return;
    var el = document.getElementById('app-version');
    el.textContent = formatVersion(d.version);
    el.hidden = false;
  }).catch(function () { /* footer stays hidden */ });
}
