ALTER TABLE playlist ADD COLUMN added_at DATETIME;
ALTER TABLE playlist ADD COLUMN download_after DATETIME;

UPDATE playlist
SET added_at = CURRENT_TIMESTAMP,
    download_after = CURRENT_TIMESTAMP
WHERE added_at IS NULL OR download_after IS NULL;

CREATE INDEX idx_playlist_download_after
ON playlist (download_after ASC, position ASC, id ASC);
