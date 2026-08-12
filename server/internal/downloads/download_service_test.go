package downloads

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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

func TestDownloadDeduplicatesConcurrentRequestsPerEpisode(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	var requests atomic.Int32
	service := NewService(db.SQL, newDownloadTestClient(func(*http.Request) (*http.Response, error) {
		if requests.Add(1) == 1 {
			close(requestStarted)
		}
		<-releaseRequest
		return &http.Response{
			StatusCode:    http.StatusOK,
			Status:        "200 OK",
			Body:          io.NopCloser(strings.NewReader("audio-data")),
			Header:        http.Header{"Content-Type": []string{"audio/mpeg"}},
			ContentLength: int64(len("audio-data")),
		}, nil
	}), downloadDir)

	results := make(chan error, 2)
	go func() {
		_, err := service.Download(context.Background(), 1)
		results <- err
	}()
	<-requestStarted
	go func() {
		_, err := service.Download(context.Background(), 1)
		results <- err
	}()
	time.Sleep(10 * time.Millisecond)
	close(releaseRequest)

	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("concurrent Download failed: %v", err)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one upstream request, got %d", got)
	}
}

func TestDeleteCancelsInFlightDownloadBeforeFileCleanup(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	requestStarted := make(chan struct{})
	service := NewService(db.SQL, newDownloadTestClient(func(req *http.Request) (*http.Response, error) {
		close(requestStarted)
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       contextBody{ctx: req.Context()},
			Header:     http.Header{"Content-Type": []string{"audio/mpeg"}},
		}, nil
	}), downloadDir)

	downloadResult := make(chan error, 1)
	go func() {
		_, err := service.Download(context.Background(), 1)
		downloadResult <- err
	}()
	<-requestStarted

	if _, err := service.Delete(context.Background(), 1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if err := <-downloadResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled download, got %v", err)
	}

	entries, err := os.ReadDir(downloadDir)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no partial download files, got %d entries", len(entries))
	}
}

func TestDownloadRejectsIncompleteBody(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")
	downloadDir := t.TempDir()
	service := NewService(db.SQL, newDownloadTestClient(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Status:        "200 OK",
			Body:          io.NopCloser(strings.NewReader("short")),
			Header:        http.Header{"Content-Type": []string{"audio/mpeg"}},
			ContentLength: 20,
		}, nil
	}), downloadDir)

	if _, err := service.Download(context.Background(), 1); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("expected incomplete download error, got %v", err)
	}
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPath.Valid {
		t.Fatalf("expected downloaded_path to remain empty, got %q", downloadedPath.String)
	}
}

func TestCleanupPartialFilesRemovesOnlyTemporaryDownloads(t *testing.T) {
	downloadDir := t.TempDir()
	podcastDir := filepath.Join(downloadDir, "1")
	if err := os.MkdirAll(podcastDir, 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	partialPath := filepath.Join(podcastDir, "episode.mp3.tmp")
	completePath := filepath.Join(podcastDir, "episode.mp3")
	if err := os.WriteFile(partialPath, []byte("partial"), 0o644); err != nil {
		t.Fatalf("write partial file: %v", err)
	}
	if err := os.WriteFile(completePath, []byte("complete"), 0o644); err != nil {
		t.Fatalf("write complete file: %v", err)
	}

	service := NewService(nil, nil, downloadDir)
	if err := service.CleanupPartialFiles(); err != nil {
		t.Fatalf("CleanupPartialFiles failed: %v", err)
	}
	if _, err := os.Stat(partialPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected partial file removed, stat err=%v", err)
	}
	if _, err := os.Stat(completePath); err != nil {
		t.Fatalf("expected complete file retained: %v", err)
	}
}

type contextBody struct {
	ctx context.Context
}

func (b contextBody) Read([]byte) (int, error) {
	<-b.ctx.Done()
	return 0, b.ctx.Err()
}

func (contextBody) Close() error { return nil }

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
