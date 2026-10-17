// RSS widget: the server fetches and sanitizes the feed; everything is rendered with textContent.

export function safeLink(href) {
  try {
    var u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (e) { return null; }
}

export function formatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function render(el, config, api) {
  var root = document.createElement('div');
  root.className = 'rss';
  var form = document.createElement('form');
  form.className = 'rss-form';
  var input = document.createElement('input');
  input.type = 'url';
  input.className = 'rss-url';
  input.placeholder = 'https://example.com/feed.xml';
  input.setAttribute('aria-label', 'Feed URL');
  input.maxLength = 2048;
  input.required = true;
  var save = document.createElement('button');
  save.type = 'submit';
  save.className = 'app-btn';
  save.textContent = 'Save';
  form.append(input, save);
  var status = document.createElement('p');
  status.className = 'rss-status';
  status.setAttribute('aria-live', 'polite');
  var list = document.createElement('ul');
  list.className = 'rss-list';
  root.append(form, status, list);
  el.append(root);

  var feedUrl = config && typeof config.feedUrl === 'string' ? config.feedUrl : '';
  input.value = feedUrl;
  var destroyed = false;
  var token = 0;
  var controller = null;

  function setStatus(msg, isError) {
    status.textContent = msg;
    status.hidden = !msg;
    status.classList.toggle('rss-error', !!isError);
  }

  function draw(items) {
    list.textContent = '';
    if (!items.length) { setStatus('No headlines found.'); return; }
    setStatus('');
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'rss-item';
      var href = it.link ? safeLink(it.link) : null;
      if (href) {
        var a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = it.title;
        li.append(a);
      } else {
        li.textContent = it.title;
      }
      var when = formatDate(it.date);
      if (when) {
        var t = document.createElement('span');
        t.className = 'rss-date';
        t.textContent = when;
        li.append(t);
      }
      list.append(li);
    });
  }

  function load() {
    var mine = ++token;
    if (controller) controller.abort();
    list.textContent = '';
    if (!feedUrl) { setStatus('Enter a feed URL to see headlines.'); return; }
    controller = new AbortController();
    setStatus('Loading headlines…');
    fetch('/api/rss?widgetId=' + encodeURIComponent(api.id), { signal: controller.signal })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body && body.error ? String(body.error) : 'Could not load the feed.');
          return body;
        });
      })
      .then(function (body) {
        if (mine !== token || destroyed) return;
        draw(Array.isArray(body.items) ? body.items : []);
      })
      .catch(function (e) {
        if (mine !== token || destroyed) return;
        setStatus(e && e.message ? e.message : 'Could not load the feed.', true);
      });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = input.value.trim();
    if (!safeLink(url)) { setStatus('Enter a valid http(s) feed URL.', true); return; }
    save.disabled = true;
    Promise.resolve(api.updateConfig({ feedUrl: url })).then(function () {
      feedUrl = url;
      save.disabled = false;
      load();
    }, function () {
      save.disabled = false;
      setStatus('Could not save the feed URL.', true);
    });
  });

  load();

  return {
    destroy: function () {
      destroyed = true;
      token++;
      if (controller) controller.abort();
    }
  };
}
