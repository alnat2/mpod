CREATE TABLE audiobook_track_exclusions (
  audiobook_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audiobook_id, track_id),
  FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES audiobook_tracks(id) ON DELETE CASCADE
);

CREATE INDEX idx_audiobook_track_exclusions_book ON audiobook_track_exclusions (audiobook_id);
