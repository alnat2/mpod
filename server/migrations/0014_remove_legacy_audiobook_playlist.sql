CREATE TABLE playlist_compact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER,
  audiobook_id INTEGER,
  position INTEGER NOT NULL,
  added_at DATETIME,
  download_after DATETIME,
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
  CHECK (
    (episode_id IS NOT NULL AND audiobook_id IS NULL) OR
    (episode_id IS NULL AND audiobook_id IS NOT NULL)
  )
);

INSERT INTO playlist_compact (id, episode_id, audiobook_id, position, added_at, download_after)
SELECT id, episode_id, audiobook_id, position, added_at, download_after
FROM playlist
WHERE episode_id IS NOT NULL OR audiobook_id IS NOT NULL;

DROP TABLE playlist;
ALTER TABLE playlist_compact RENAME TO playlist;

CREATE INDEX idx_playlist_download_after ON playlist (download_after ASC, position ASC, id ASC);
CREATE INDEX idx_playlist_position ON playlist (position ASC, id ASC);
CREATE UNIQUE INDEX idx_playlist_episode_id ON playlist (episode_id) WHERE episode_id IS NOT NULL;
CREATE UNIQUE INDEX idx_playlist_audiobook_id ON playlist (audiobook_id) WHERE audiobook_id IS NOT NULL;

DROP TABLE audiobook_track_exclusions;
