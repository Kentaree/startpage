CREATE TABLE widgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('weather', 'clock', 'rss')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX widgets_user_id ON widgets(user_id);

CREATE TABLE layouts (
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  breakpoint        TEXT NOT NULL CHECK (breakpoint IN ('lg', 'md', 'sm')),
  widget_order_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, breakpoint)
);

CREATE TABLE rss_cache (
  feed_url   TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  etag       TEXT,
  items_json TEXT NOT NULL DEFAULT '[]'
);
