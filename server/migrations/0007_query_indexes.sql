CREATE INDEX idx_episodes_podcast_published
ON episodes (podcast_id, published_at DESC, id DESC);

CREATE INDEX idx_playlist_position
ON playlist (position ASC, id ASC);
