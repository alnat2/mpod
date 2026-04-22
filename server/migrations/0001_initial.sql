CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE podcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  rss_url TEXT NOT NULL UNIQUE,
  last_checked DATETIME,
  update_time TEXT
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id INTEGER NOT NULL,
  external_episode_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  guid TEXT,
  audio_url TEXT NOT NULL,
  duration INTEGER,
  downloaded_path TEXT,
  is_listened BOOLEAN NOT NULL DEFAULT 0,
  published_at DATETIME,
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE,
  UNIQUE (podcast_id, external_episode_key)
);

CREATE TABLE playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE playback (
  episode_id INTEGER PRIMARY KEY,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE scheduler_state (
  job_name TEXT PRIMARY KEY,
  last_run_at DATETIME,
  last_success_at DATETIME,
  last_failure_at DATETIME,
  last_error TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO settings (key, value) VALUES ('daily_refresh_time', '03:00');
