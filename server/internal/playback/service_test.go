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
	state, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 80,
		ClientUpdatedAt: &staleTime,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if state.PositionSeconds != 120 {
		t.Fatalf("expected stale update to preserve position 120, got %d", state.PositionSeconds)
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

	state, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 2390,
		DurationSeconds: 2400,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if state.PositionSeconds != 2400 {
		t.Fatalf("expected completion to clamp position to 2400, got %d", state.PositionSeconds)
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

	state, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 180,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if state.PositionSeconds != 180 {
		t.Fatalf("expected position to advance to 180, got %d", state.PositionSeconds)
	}
	if !state.LastUpdated.Equal(currentTime.Add(5 * time.Minute)) {
		t.Fatalf("expected last updated to move forward, got %v", state.LastUpdated)
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

	state, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if state.PositionSeconds != 120 {
		t.Fatalf("expected explicit seek to persist position 120, got %d", state.PositionSeconds)
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

	state, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         false,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if state.PositionSeconds != 240 {
		t.Fatalf("expected drifted backward update to preserve position 240, got %d", state.PositionSeconds)
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
