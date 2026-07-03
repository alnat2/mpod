package downloads

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/storage"
)

func TestDownloadReturnsExistingFileWithoutHTTPFetch(t *testing.T) {
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

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, downloadPath)

	called := false
	service := NewService(db.SQL, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, io.EOF
	})}, downloadDir)

	result, err := service.Download(context.Background(), 1)
	if err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !result.Downloaded {
		t.Fatalf("expected Downloaded=true")
	}
	if called {
		t.Fatalf("expected no HTTP fetch when local file exists")
	}
}

func TestGetLocalPathReturnsEmptyWhenDownloadedFileIsMissing(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	stalePath := filepath.Join(downloadDir, "1", "missing.mp3")
	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, stalePath)

	service := NewService(db.SQL, nil, downloadDir)

	path, err := service.GetLocalPath(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetLocalPath failed: %v", err)
	}
	if path != "" {
		t.Fatalf("expected empty path for missing file, got %q", path)
	}
}

func TestGetLocalPathClearsNonPlayableDownloadedFile(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("<html>not audio</html>"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, downloadPath)

	service := NewService(db.SQL, nil, downloadDir)

	path, err := service.GetLocalPath(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetLocalPath failed: %v", err)
	}
	if path != "" {
		t.Fatalf("expected empty path for non-playable local file, got %q", path)
	}

	var downloadedPathAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPathAfter); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPathAfter.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPathAfter.String)
	}
}

func TestDeleteClearsDownloadedPathAndRemovesFile(t *testing.T) {
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

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, downloadPath)

	service := NewService(db.SQL, nil, downloadDir)
	result, err := service.Delete(context.Background(), 1)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if result.Downloaded {
		t.Fatalf("expected Downloaded=false after delete")
	}

	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be removed, stat err=%v", err)
	}

	var downloadedPathAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPathAfter); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPathAfter.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPathAfter.String)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
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

func mustExec(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}
