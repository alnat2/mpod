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

	"github.com/cross/mpod/server/internal/podcasts"
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

// readValidMP3Body returns the bytes of the shared valid.mp3 fixture.
// The fixture is a 3-second synthetic MPEG stream used by audiobooks tests.
func readValidMP3Body(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "valid.mp3"))
	if err != nil {
		t.Fatalf("read valid.mp3 fixture: %v", err)
	}
	return data
}

// validMP3Duration is the exact rounded duration of testdata/valid.mp3 as
// reported by audiometa.ReadAudioDuration (3 seconds synthetic MPEG stream).
const validMP3Duration = int64(3)

// TestDownloadWritesDurationWhenEpisodeLacksDuration covers the primary regression:
// episode has no itunes:duration in the feed → file is downloaded → duration measured
// from the local file and written to episodes.duration.
func TestDownloadWritesDurationWhenEpisodeLacksDuration(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	// duration column omitted → NULL
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.mp3")

	mp3Body := readValidMP3Body(t)
	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(string(mp3Body))),
			Header:     http.Header{"Content-Type": []string{"audio/mpeg"}},
		}, nil
	}), downloadDir)

	result, err := service.Download(context.Background(), 1)
	if err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !result.Downloaded {
		t.Fatalf("expected downloaded=true")
	}

	var duration sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = 1`).Scan(&duration); err != nil {
		t.Fatalf("query duration: %v", err)
	}
	if !duration.Valid {
		t.Fatalf("expected duration to be written from local file, got NULL")
	}
	if duration.Int64 != validMP3Duration {
		t.Fatalf("expected duration %d, got %d", validMP3Duration, duration.Int64)
	}
}

// TestDownloadDoesNotOverwriteExistingDuration covers the guard rule:
// episode already has a duration from the RSS feed → download must not replace it.
func TestDownloadDoesNotOverwriteExistingDuration(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	const feedDuration = int64(7200)
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration) VALUES (1, 1, 'ep-1', 'Episode 1', ?, ?)`, "https://example.com/ep1.mp3", feedDuration)

	mp3Body := readValidMP3Body(t)
	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(string(mp3Body))),
			Header:     http.Header{"Content-Type": []string{"audio/mpeg"}},
		}, nil
	}), downloadDir)

	if _, err := service.Download(context.Background(), 1); err != nil {
		t.Fatalf("Download failed: %v", err)
	}

	var duration sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = 1`).Scan(&duration); err != nil {
		t.Fatalf("query duration: %v", err)
	}
	if !duration.Valid || duration.Int64 != feedDuration {
		t.Fatalf("expected feed duration %d to be preserved, got %+v", feedDuration, duration)
	}
}

// TestDownloadDoesNotFabricateDurationForUnsupportedFile covers the error rule:
// if the local file cannot yield a reliable duration (unsupported content-type
// and unsupported extension), no fabricated value must be written. The download
// itself must still succeed.
func TestDownloadDoesNotFabricateDurationForUnsupportedFile(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	// audio_url has .ogg extension; Content-Type audio/ogg — both unsupported by audiometa.
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://example.com/ep1.ogg")

	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader("audio-data")),
			Header:     http.Header{"Content-Type": []string{"audio/ogg"}},
		}, nil
	}), downloadDir)

	result, err := service.Download(context.Background(), 1)
	if err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !result.Downloaded {
		t.Fatalf("expected download to succeed even when duration cannot be read")
	}

	var duration sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = 1`).Scan(&duration); err != nil {
		t.Fatalf("query duration: %v", err)
	}
	if duration.Valid {
		t.Fatalf("expected duration to remain NULL for unsupported/corrupt file, got %d", duration.Int64)
	}
}

// TestDownloadWritesDurationForExtensionlessURL verifies that when the audio URL
// carries no path extension (e.g. a CDN query-string URL), the Content-Type header
// is used as a hint so that duration can still be extracted from the downloaded file.
func TestDownloadWritesDurationForExtensionlessURL(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	mustExecDownload(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	// URL has no file extension — buildFilename will produce a path without suffix.
	mustExecDownload(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', ?)`, "https://cdn.example.com/audio?id=42&format=mp3")

	mp3Body := readValidMP3Body(t)
	service := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(string(mp3Body))),
			// Content-Type audio/mpeg is the hint audiometa uses when the path has no extension.
			Header: http.Header{"Content-Type": []string{"audio/mpeg"}},
		}, nil
	}), downloadDir)

	result, err := service.Download(context.Background(), 1)
	if err != nil {
		t.Fatalf("Download failed: %v", err)
	}
	if !result.Downloaded {
		t.Fatalf("expected downloaded=true")
	}

	var duration sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = 1`).Scan(&duration); err != nil {
		t.Fatalf("query duration: %v", err)
	}
	if !duration.Valid {
		t.Fatalf("expected duration to be written even for extensionless URL, got NULL")
	}
	if duration.Int64 != validMP3Duration {
		t.Fatalf("expected duration %d, got %d", validMP3Duration, duration.Int64)
	}
}

// TestDownloadDurationRegressionFullCycle is the focused regression:
//  1. Episode has no <itunes:duration> → RSS import stores NULL duration.
//  2. Episode is downloaded with a valid local MP3 → duration written to DB.
//  3. RSS refresh runs again without a duration tag → the real podcasts.Service
//     upsert (COALESCE) must preserve the measured duration.
func TestDownloadDurationRegressionFullCycle(t *testing.T) {
	db := newDownloadTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()

	// Feed XML has no <itunes:duration>; the enclosure URL ends in .mp3 so that
	// the downloaded filename will also carry the .mp3 extension.
	const feedURL = "https://example.com/feed.xml"
	const audioURL = "https://cdn.example.com/ep1.mp3"
	feedXML := rssNoDuration("Podcast", "Episode 1", "guid-ep1", audioURL)

	// Create the podcast and import the episode using the real podcasts service.
	podcastSvc := podcasts.NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlFeedResponse(feedXML), nil
	}))
	podcast, err := podcastSvc.CreateFromFeed(context.Background(), feedURL)
	if err != nil {
		t.Fatalf("CreateFromFeed failed: %v", err)
	}

	// Step 1: duration is NULL immediately after feed import.
	var episodeID int64
	var durationBefore sql.NullInt64
	if err := db.SQL.QueryRow(
		`SELECT id, duration FROM episodes WHERE podcast_id = ? AND external_episode_key = 'guid-ep1'`,
		podcast.ID,
	).Scan(&episodeID, &durationBefore); err != nil {
		t.Fatalf("query episode before download: %v", err)
	}
	if durationBefore.Valid {
		t.Fatalf("expected NULL duration after feed import without itunes:duration, got %d", durationBefore.Int64)
	}

	// Step 2: download a valid MP3 — duration should be written.
	mp3Body := readValidMP3Body(t)
	downloadSvc := NewService(db.SQL, newDownloadTestClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(string(mp3Body))),
			Header:     http.Header{"Content-Type": []string{"audio/mpeg"}},
		}, nil
	}), downloadDir)

	if _, err := downloadSvc.Download(context.Background(), episodeID); err != nil {
		t.Fatalf("Download failed: %v", err)
	}

	var durationAfterDownload sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = ?`, episodeID).Scan(&durationAfterDownload); err != nil {
		t.Fatalf("query post-download duration: %v", err)
	}
	if !durationAfterDownload.Valid || durationAfterDownload.Int64 != validMP3Duration {
		t.Fatalf("expected duration %d after download, got %+v", validMP3Duration, durationAfterDownload)
	}

	// Step 3: real RSS refresh with the same feed (still no <itunes:duration>).
	// The real upsert COALESCE must preserve the measured duration.
	if _, _, err := podcastSvc.Refresh(context.Background(), podcast.ID); err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}

	var durationAfterRefresh sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT duration FROM episodes WHERE id = ?`, episodeID).Scan(&durationAfterRefresh); err != nil {
		t.Fatalf("query post-refresh duration: %v", err)
	}
	if !durationAfterRefresh.Valid {
		t.Fatalf("expected duration to survive real RSS refresh without itunes:duration, got NULL")
	}
	if durationAfterRefresh.Int64 != validMP3Duration {
		t.Fatalf("expected duration %d preserved after refresh, got %d", validMP3Duration, durationAfterRefresh.Int64)
	}
}

// rssNoDuration builds a minimal RSS feed with one episode and no itunes:duration.
func rssNoDuration(podcastTitle, episodeTitle, guid, audioURL string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<rss version="2.0">` + "\n" +
		`  <channel>` + "\n" +
		`    <title>` + podcastTitle + `</title>` + "\n" +
		`    <item>` + "\n" +
		`      <title>` + episodeTitle + `</title>` + "\n" +
		`      <guid>` + guid + `</guid>` + "\n" +
		`      <enclosure url="` + audioURL + `" type="audio/mpeg"/>` + "\n" +
		`    </item>` + "\n" +
		`  </channel>` + "\n" +
		`</rss>`
}

// xmlFeedResponse wraps an RSS string in an http.Response with the correct
// Content-Type, matching what podcasts tests use.
func xmlFeedResponse(body string) *http.Response {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
	resp.Header.Set("Content-Type", "application/rss+xml")
	return resp
}
