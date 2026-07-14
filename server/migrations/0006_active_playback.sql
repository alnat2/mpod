CREATE TABLE active_playback (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  episode_id INTEGER,
  last_updated DATETIME NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL
);
