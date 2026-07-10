package playback

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playlist"
	"github.com/cross/mpod/server/internal/storage"
)

func TestUpdateIgnoresStaleClientUpdate(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	staleTime := currentTime.Add(-1 * time.Minute)
	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 80,
		ClientUpdatedAt: &staleTime,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 120 {
		t.Fatalf("expected stale update to preserve position 120, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateCompletionAppliesSideEffects(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 4, 22, 11, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 2390,
		DurationSeconds: 2400,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 2400 {
		t.Fatalf("expected completion to clamp position to 2400, got %d", result.Playback.PositionSeconds)
	}
	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if !listened {
		t.Fatalf("expected episode to be marked listened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 0 {
		t.Fatalf("expected episode to be removed from playlist")
	}

	var downloadedPathAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPathAfter); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPathAfter.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %v", downloadedPathAfter.String)
	}

	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted, stat err=%v", err)
	}
}

func TestUpdateAdvancesPositionWhenProgressMovesForward(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 180,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 180 {
		t.Fatalf("expected position to advance to 180, got %d", result.Playback.PositionSeconds)
	}
	if !result.Playback.LastUpdated.Equal(currentTime.Add(5 * time.Minute)) {
		t.Fatalf("expected last updated to move forward, got %v", result.Playback.LastUpdated)
	}
}

func TestUpdateAllowsLargeBackwardSeekWhenExplicit(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 240, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 120 {
		t.Fatalf("expected explicit seek to persist position 120, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateIgnoresBackwardDriftWithoutSeek(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 240, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         false,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 240 {
		t.Fatalf("expected drifted backward update to preserve position 240, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateCompletionSelectsHighestEarlierIncompleteEpisodeWhenFinishingLastPlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "3", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, downloaded_path, is_listened) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3', 600, ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (2, 585, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       3,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID == nil || *result.NextEpisodeID != 1 {
		t.Fatalf("expected fallback episode 1, got %v", result.NextEpisodeID)
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected fallback episode to remain in playlist, got %d rows", playlistCount)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected fallback episode to remain unlistened")
	}

	var position int64
	if err := db.SQL.QueryRow(`SELECT position_seconds FROM playback WHERE episode_id = 1`).Scan(&position); err != nil {
		t.Fatalf("query playback position: %v", err)
	}
	if position != 120 {
		t.Fatalf("expected fallback episode playback position to remain 120, got %d", position)
	}
}

func TestUpdateCompletionReturnsNoFallbackWhenNoEarlierEligibleEpisodeExists(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 1)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}
}

func TestUpdateCompletionDoesNotUseFallbackWhenFinishedEpisodeIsNotLastPlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}
}

func TestUpdateCompletionKeepsEpisodeInPlaylistWhenDownloadDeletionFails(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 4, 22, 11, 0, 0, 0, time.UTC) }

	if _, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 300,
		DurationSeconds: 300,
		Completed:       true,
	}); err == nil {
		t.Fatal("expected Update to fail")
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d rows", playlistCount)
	}
}

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := storage.Open(path)
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	if err := storage.Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("storage.Migrate: %v", err)
	}
	return db
}

func mustExec(t *testing.T, db execer, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}
