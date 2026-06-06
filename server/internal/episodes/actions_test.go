package episodes

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/storage"
)

func TestSetListenedDeletesDownloadedFile(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, true); err != nil {
		t.Fatalf("SetListened failed: %v", err)
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if !listened {
		t.Fatalf("expected episode to be listened")
	}
	if downloadedPath.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPath.String)
	}
	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected download file to be deleted, stat err=%v", err)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 0 {
		t.Fatalf("expected episode to be removed from playlist, got %d playlist rows", count)
	}
}

func TestSetListenedFalseDoesNotDeleteDownload(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 1)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, false); err != nil {
		t.Fatalf("SetListened failed: %v", err)
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to be unlistened")
	}
	if !downloadedPath.Valid || downloadedPath.String != downloadPath {
		t.Fatalf("expected downloaded_path to remain set, got %+v", downloadedPath)
	}
	if _, err := os.Stat(downloadPath); err != nil {
		t.Fatalf("expected file to remain, stat err=%v", err)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d playlist rows", count)
	}
}

func TestSetListenedKeepsEpisodeUnlistenedWhenDownloadDeletionFails(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, true); err == nil {
		t.Fatal("expected SetListened to fail")
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened")
	}
	if !downloadedPath.Valid || downloadedPath.String != downloadPath {
		t.Fatalf("expected downloaded_path to remain set, got %+v", downloadedPath)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d playlist rows", count)
	}
}

func TestSetListenedMissingEpisode(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir()))
	if err := actions.SetListened(context.Background(), 999, true); err != ErrEpisodeNotFound {
		t.Fatalf("expected ErrEpisodeNotFound, got %v", err)
	}
}

func newActionsTestDB(t *testing.T) *storage.DB {
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

func mustExecActions(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func playlistCountForEpisode(t *testing.T, db *storage.DB, episodeID int64) int {
	t.Helper()

	var count int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = ?`, episodeID).Scan(&count); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	return count
}
