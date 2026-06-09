package downloads

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cross/mpod/server/internal/storage"
)

func TestDownloadFetchesAndPersistsFile(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader("audio-data")),
			Header:     make(http.Header),
		}, nil
	}), downloadDir)
	result, err := service.Download(context.Background(), 1)
	if err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !result.Downloaded {
		t.Fatalf("expected downloaded=true, got %+v", result)
	}

	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if !downloadedPath.Valid {
		t.Fatalf("expected downloaded_path to be stored")
	}
	data, err := os.ReadFile(downloadedPath.String)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != "audio-data" {
		t.Fatalf("unexpected downloaded contents %q", string(data))
	}
}

func TestDownloadClearsStalePathAndRedownloads(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	stalePath := filepath.Join(downloadDir, "1", "stale.mp3")
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode 1', ?, ?)`, "https://example.com/ep1.mp3", stalePath)

	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader("fresh-audio")),
			Header:     make(http.Header),
		}, nil
	}), downloadDir)
	if _, err := service.Download(context.Background(), 1); err != nil {
		t.Fatalf("Download failed: %v", err)
	}

	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if !downloadedPath.Valid || downloadedPath.String == stalePath {
		t.Fatalf("expected stale path to be replaced, got %+v", downloadedPath)
	}
}

func TestDownloadRejectsServerFailure(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadGateway,
			Status:     "502 Bad Gateway",
			Body:       io.NopCloser(strings.NewReader("nope")),
			Header:     make(http.Header),
		}, nil
	}), t.TempDir())
	if _, err := service.Download(context.Background(), 1); err == nil {
		t.Fatalf("expected download failure for non-2xx response")
	}
}

func TestDownloadRejectsNonAudioResponse(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader("<html>not audio</html>")),
			Header: http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
			},
		}, nil
	}), t.TempDir())
	if _, err := service.Download(context.Background(), 1); err == nil {
		t.Fatalf("expected download failure for non-audio response")
	}

	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPath.Valid {
		t.Fatalf("expected downloaded_path to remain empty")
	}
}

func TestDownloadMissingEpisode(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, &http.Client{}, t.TempDir())
	if _, err := service.Download(context.Background(), 999); err != ErrEpisodeNotFound {
		t.Fatalf("expected ErrEpisodeNotFound, got %v", err)
	}
}

func newDownloadTestDB(t *testing.T) *storage.DB {
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

func mustExecDownload(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func newDownloadTestClient(fn func(*http.Request) (*http.Response, error)) *http.Client {
	return &http.Client{
		Transport: roundTripperFunc(fn),
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return fn(r)
}
