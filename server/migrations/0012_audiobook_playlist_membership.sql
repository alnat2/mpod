CREATE TABLE audiobook_playlist_tracks (
  audiobook_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audiobook_id, track_id),
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES audiobook_tracks(id) ON DELETE CASCADE
);

CREATE INDEX idx_audiobook_playlist_tracks_track
  ON audiobook_playlist_tracks (track_id);

-- Preserve the selected chapters represented by legacy per-track playlist rows.
INSERT OR IGNORE INTO audiobook_playlist_tracks (audiobook_id, track_id, added_at)
SELECT t.audiobook_id, t.id, COALESCE(p.added_at, CURRENT_TIMESTAMP)
FROM playlist p
JOIN audiobook_tracks t ON t.id = p.audiobook_track_id
WHERE p.audiobook_track_id IS NOT NULL;

-- A legacy parent row meant "all chapters except exclusions". Materialize that
-- selection so future scans cannot silently add new files to an existing item.
INSERT OR IGNORE INTO audiobook_playlist_tracks (audiobook_id, track_id, added_at)
SELECT p.audiobook_id, t.id, COALESCE(p.added_at, CURRENT_TIMESTAMP)
FROM playlist p
JOIN audiobook_tracks t ON t.audiobook_id = p.audiobook_id
LEFT JOIN audiobook_track_exclusions e
  ON e.audiobook_id = p.audiobook_id AND e.track_id = t.id
WHERE p.audiobook_id IS NOT NULL AND e.track_id IS NULL;

-- Collapse legacy chapter rows into one parent row per book while preserving
-- the earliest queue position for books that had no parent row yet.
INSERT OR IGNORE INTO playlist (audiobook_id, position, added_at)
SELECT t.audiobook_id, MIN(p.position), MIN(COALESCE(p.added_at, CURRENT_TIMESTAMP))
FROM playlist p
JOIN audiobook_tracks t ON t.id = p.audiobook_track_id
WHERE p.audiobook_track_id IS NOT NULL
GROUP BY t.audiobook_id;

DELETE FROM playlist WHERE audiobook_track_id IS NOT NULL;
DELETE FROM playlist
WHERE audiobook_id IS NOT NULL
  AND NOT EXISTS(
    SELECT 1 FROM audiobook_playlist_tracks selected
    WHERE selected.audiobook_id = playlist.audiobook_id
  );
DELETE FROM audiobook_track_exclusions;
