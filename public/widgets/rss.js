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

// Feed URLs from a config, reading the legacy single `feedUrl` shape too.
export function feedUrlsFromConfig(config) {
  if (!config) return [];
  if (Array.isArray(config.feedUrls)) {
    return config.feedUrls.filter(function (u) { return typeof u === 'string' && u; });
  }
  return typeof config.feedUrl === 'string' && config.feedUrl ? [config.feedUrl] : [];
}

export function buildConfig(url) {
  return { feedUrls: [url] };
}

// "BBC News · 17/10/2026" style line under a headline.
export function formatMeta(item) {
  var parts = [];
  if (item && item.source) parts.push(item.source);
  var when = item ? formatDate(item.date) : '';
  if (when) parts.push(when);
  return parts.join(' · ');
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

  var feedUrls = feedUrlsFromConfig(config);
  var feedUrl = feedUrls.length ? feedUrls[0] : '';
  var multi = feedUrls.length > 1;
  input.value = multi ? '' : feedUrl;
  if (multi) {
    // Several feeds can't be edited in the one-line form; point at Settings instead.
    form.hidden = true;
    var hint = document.createElement('p');
    hint.className = 'rss-hint';
    hint.append(feedUrls.length + ' feeds · ');
    var link = document.createElement('a');
    link.href = '/settings.html';
    link.textContent = 'Edit in Settings';
    hint.append(link);
    root.append(hint);
  }
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
      var when = formatMeta(it);
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
        if (Array.isArray(body.errors) && body.errors.length) {
          setStatus(body.errors.length + ' of ' + feedUrls.length + ' feeds could not be loaded.', true);
        }
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
    Promise.resolve(api.updateConfig(buildConfig(url))).then(function () {
      feedUrl = url;
      feedUrls = [url];
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
