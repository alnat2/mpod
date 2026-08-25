CREATE TABLE audiobooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  rel_path TEXT NOT NULL UNIQUE,
  cover_path TEXT,
  total_duration INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audiobook_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audiobook_id INTEGER NOT NULL,
  track_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  is_listened BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
);

CREATE INDEX idx_audiobook_tracks_audiobook_id ON audiobook_tracks (audiobook_id, track_number);

CREATE TABLE audiobook_playback (
  track_id INTEGER PRIMARY KEY,
  audiobook_id INTEGER NOT NULL,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES audiobook_tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
);

CREATE INDEX idx_audiobook_playback_audiobook_id ON audiobook_playback (audiobook_id);

CREATE TABLE playlist_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER,
  audiobook_id INTEGER,
  position INTEGER NOT NULL,
  added_at DATETIME,
  download_after DATETIME,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
  CHECK ((episode_id IS NOT NULL AND audiobook_id IS NULL) OR (episode_id IS NULL AND audiobook_id IS NOT NULL))
);

INSERT INTO playlist_new (id, episode_id, position, added_at, download_after)
SELECT id, episode_id, position, added_at, download_after FROM playlist;

DROP TABLE playlist;
ALTER TABLE playlist_new RENAME TO playlist;

CREATE INDEX idx_playlist_download_after ON playlist (download_after ASC, position ASC, id ASC);
CREATE INDEX idx_playlist_position ON playlist (position ASC, id ASC);
CREATE UNIQUE INDEX idx_playlist_episode_id ON playlist (episode_id) WHERE episode_id IS NOT NULL;
CREATE UNIQUE INDEX idx_playlist_audiobook_id ON playlist (audiobook_id) WHERE audiobook_id IS NOT NULL;

ALTER TABLE active_playback ADD COLUMN audiobook_id INTEGER REFERENCES audiobooks(id) ON DELETE SET NULL;
ALTER TABLE active_playback ADD COLUMN audiobook_track_id INTEGER REFERENCES audiobook_tracks(id) ON DELETE SET NULL;
