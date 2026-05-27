package playlist

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/downloads"
)

func TestRemoveDeletesDownloadThenPlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadsDir := t.TempDir()
	filePath := filepath.Join(downloadsDir, "episode.mp3")
	if err := os.WriteFile(filePath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, filePath)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadsDir))
	if err := actions.Remove(context.Background(), 1); err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted, stat err=%v", err)
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("count playlist rows: %v", err)
	}
	if playlistCount != 0 {
		t.Fatalf("expected playlist item to be removed, got %d rows", playlistCount)
	}

	var downloadedPath string
	if err := db.SQL.QueryRow(`SELECT COALESCE(downloaded_path, '') FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("load downloaded_path: %v", err)
	}
	if downloadedPath != "" {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPath)
	}
}

func TestRemoveKeepsPlaylistItemWhenDownloadDeletionFails(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadsDir := t.TempDir()
	downloadPath := filepath.Join(downloadsDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, downloadPath)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadsDir))
	if err := actions.Remove(context.Background(), 1); err == nil {
		t.Fatal("expected Remove to fail")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("count playlist rows: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected playlist item to remain, got %d rows", playlistCount)
	}

	var downloadedPath string
	if err := db.SQL.QueryRow(`SELECT COALESCE(downloaded_path, '') FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("load downloaded_path: %v", err)
	}
	if downloadedPath != downloadPath {
		t.Fatalf("expected downloaded_path to remain %q, got %q", downloadPath, downloadedPath)
	}
}
