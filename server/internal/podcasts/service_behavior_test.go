package podcasts

import (
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/storage"
)

func TestCreateFromFeedImportsPodcastAndEpisodes(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlResponse(testRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	}))
	podcast, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml#fragment")
	if err != nil {
		t.Fatalf("CreateFromFeed failed: %v", err)
	}
	if podcast.ID == 0 || podcast.Title != "Test Podcast" {
		t.Fatalf("unexpected podcast: %+v", podcast)
	}
	if podcast.RSSURL != "https://example.com/feed.xml" {
		t.Fatalf("expected normalized feed URL, got %q", podcast.RSSURL)
	}

	var episodeCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM episodes WHERE podcast_id = ?`, podcast.ID).Scan(&episodeCount); err != nil {
		t.Fatalf("count episodes: %v", err)
	}
	if episodeCount != 1 {
		t.Fatalf("expected 1 imported episode, got %d", episodeCount)
	}
}

func TestCreateFromFeedRejectsDuplicateSubscription(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlResponse(testRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	}))
	if _, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml"); err != nil {
		t.Fatalf("initial CreateFromFeed failed: %v", err)
	}
	if _, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml"); err != ErrDuplicateSubscription {
		t.Fatalf("expected ErrDuplicateSubscription, got %v", err)
	}
}

func TestCreateFromFeedParsesRealTransistorFixture(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := firstCompleteTransistorFixture(t)
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlResponse(fixture), nil
	}))

	podcast, err := service.CreateFromFeed(context.Background(), "https://feeds.transistor.fm/build-your-saas")
	if err != nil {
		t.Fatalf("CreateFromFeed failed: %v", err)
	}
	if podcast.Title != "Build Your SaaS" {
		t.Fatalf("expected real feed title to be imported, got %q", podcast.Title)
	}

	var episodeCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM episodes WHERE podcast_id = ?`, podcast.ID).Scan(&episodeCount); err != nil {
		t.Fatalf("count imported episodes: %v", err)
	}
	if episodeCount == 0 {
		t.Fatalf("expected real feed fixture to import episodes")
	}
}

func TestCreateFromFeedRejectsHTMLLandingPageFixture(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := readPodcastFixture(t, "simplecast_that_creative_life.html")
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(fixture)),
			Header:     make(http.Header),
		}
		resp.Header.Set("Content-Type", "text/html; charset=utf-8")
		return resp, nil
	}))

	_, err := service.CreateFromFeed(context.Background(), "https://thatcreativelife.simplecast.com")
	if !errors.Is(err, ErrFeedParseFailed) {
		t.Fatalf("expected ErrFeedParseFailed, got %v", err)
	}
	if !strings.Contains(err.Error(), "text/html") || !strings.Contains(strings.ToLower(err.Error()), "<!doctype html>") {
		t.Fatalf("expected parse error to preserve HTML diagnostic context, got %v", err)
	}
}

func TestCreateFromFeedParsesRealTransistorFixtureWithoutContentType(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := firstCompleteTransistorFixture(t)
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(fixture)),
			Header:     make(http.Header),
		}
		return resp, nil
	}))

	podcast, err := service.CreateFromFeed(context.Background(), "https://feeds.transistor.fm/build-your-saas")
	if err != nil {
		t.Fatalf("CreateFromFeed failed without content type: %v", err)
	}
	if podcast.Title != "Build Your SaaS" {
		t.Fatalf("expected fixture title to be imported, got %q", podcast.Title)
	}
}

func TestCreateFromFeedRejectsHTMLLandingPageFixtureWithoutContentType(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := readPodcastFixture(t, "simplecast_that_creative_life.html")
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(fixture)),
			Header:     make(http.Header),
		}
		return resp, nil
	}))

	_, err := service.CreateFromFeed(context.Background(), "https://thatcreativelife.simplecast.com")
	if !errors.Is(err, ErrFeedParseFailed) {
		t.Fatalf("expected ErrFeedParseFailed, got %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "<!doctype html>") {
		t.Fatalf("expected html preview to be preserved without content-type, got %v", err)
	}
}

func TestDeleteRemovesCascadeDataAndFiles(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecPodcast(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecPodcast(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://cdn.example.com/1.mp3', ?)`, downloadPath)
	mustExecPodcast(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecPodcast(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 5, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, newPodcastTestClient(nil))
	if err := service.Delete(context.Background(), 1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	assertPodcastCount(t, db.SQL, `SELECT COUNT(*) FROM podcasts`, 0)
	assertPodcastCount(t, db.SQL, `SELECT COUNT(*) FROM episodes`, 0)
	assertPodcastCount(t, db.SQL, `SELECT COUNT(*) FROM playlist`, 0)
	assertPodcastCount(t, db.SQL, `SELECT COUNT(*) FROM playback`, 0)
	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected download file removal, stat err=%v", err)
	}
}

func TestDeleteReturnsNotFoundForMissingPodcast(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, newPodcastTestClient(nil))
	if err := service.Delete(context.Background(), 999); err != ErrPodcastNotFound {
		t.Fatalf("expected ErrPodcastNotFound, got %v", err)
	}
}

func TestRefreshUpsertsEpisodesWithoutDuplicates(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	responseBody := testRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlResponse(responseBody), nil
	}))
	podcast, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if err != nil {
		t.Fatalf("CreateFromFeed failed: %v", err)
	}

	responseBody = testRSSFeedWithTwoEpisodes("Renamed Podcast", "Episode One Updated", "guid-1", "https://cdn.example.com/1-new.mp3", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")
	newEpisodes, _, err := service.Refresh(context.Background(), podcast.ID)
	if err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	if newEpisodes != 1 {
		t.Fatalf("expected 1 new episode on refresh, got %d", newEpisodes)
	}

	var title, audioURL string
	if err := db.SQL.QueryRow(`SELECT title, audio_url FROM episodes WHERE podcast_id = ? AND external_episode_key = 'guid-1'`, podcast.ID).Scan(&title, &audioURL); err != nil {
		t.Fatalf("query updated episode: %v", err)
	}
	if title != "Episode One Updated" || audioURL != "https://cdn.example.com/1-new.mp3" {
		t.Fatalf("expected updated episode metadata, got title=%q audioURL=%q", title, audioURL)
	}

	var episodeCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM episodes WHERE podcast_id = ?`, podcast.ID).Scan(&episodeCount); err != nil {
		t.Fatalf("count episodes: %v", err)
	}
	if episodeCount != 2 {
		t.Fatalf("expected 2 episodes after refresh, got %d", episodeCount)
	}
}

func mustExecPodcast(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func assertPodcastCount(t *testing.T, db *sql.DB, query string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("QueryRow %q failed: %v", query, err)
	}
	if got != want {
		t.Fatalf("QueryRow %q = %d, want %d", query, got, want)
	}
}

func TestDeleteRemovesFilesAndCascadeData(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecBehavior(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?)`, downloadPath)
	mustExecBehavior(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecBehavior(t, db, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 10, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, &http.Client{})
	if err := service.Delete(context.Background(), 1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	assertCount(t, db.SQL, `SELECT COUNT(*) FROM podcasts`, 0)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes`, 0)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM playlist`, 0)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM playback`, 0)
	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected podcast download file to be removed, stat err=%v", err)
	}
}

func TestRefreshAllRetriesTransientFailuresAndContinues(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'One', 'https://example.com/one.xml')`)
	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (2, 'Two', 'https://example.com/two.xml')`)

	attempts := map[string]int{}
	sleepCalls := 0
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		attempts[r.URL.Path]++
		switch r.URL.Path {
		case "/one.xml":
			if attempts[r.URL.Path] < 3 {
				return nil, io.EOF
			}
			return xmlResponse(testRSSFeed("One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		case "/two.xml":
			return xmlResponse(testRSSFeed("Two", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")), nil
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
			return nil, nil
		}
	}))
	service.retryDelays = []time.Duration{0, 0, 0}
	service.sleep = func(ctx context.Context, delay time.Duration) error {
		sleepCalls++
		return nil
	}

	if err := service.RefreshAll(context.Background()); err != nil {
		t.Fatalf("RefreshAll failed: %v", err)
	}

	if attempts["/one.xml"] != 3 {
		t.Fatalf("expected three attempts for first podcast, got %d", attempts["/one.xml"])
	}
	if attempts["/two.xml"] != 1 {
		t.Fatalf("expected one attempt for second podcast, got %d", attempts["/two.xml"])
	}
	if sleepCalls != 2 {
		t.Fatalf("expected two retry sleeps, got %d", sleepCalls)
	}

	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 1`, 1)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 2`, 1)
}

func TestRefreshAllReturnsErrorAfterExhaustingRetriesButContinuesOtherPodcasts(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'One', 'https://example.com/one.xml')`)
	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (2, 'Two', 'https://example.com/two.xml')`)

	attempts := map[string]int{}
	sleepCalls := 0
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		attempts[r.URL.Path]++
		switch r.URL.Path {
		case "/one.xml":
			return nil, io.EOF
		case "/two.xml":
			return xmlResponse(testRSSFeed("Two", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")), nil
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
			return nil, nil
		}
	}))
	service.retryDelays = []time.Duration{0, 0, 0}
	service.sleep = func(ctx context.Context, delay time.Duration) error {
		sleepCalls++
		return nil
	}

	err := service.RefreshAll(context.Background())
	if err == nil {
		t.Fatalf("expected RefreshAll to report an aggregate failure")
	}
	if !strings.Contains(err.Error(), "podcast 1") {
		t.Fatalf("expected aggregate error to mention failed podcast, got %v", err)
	}
	if attempts["/one.xml"] != 4 {
		t.Fatalf("expected four attempts for first podcast, got %d", attempts["/one.xml"])
	}
	if attempts["/two.xml"] != 1 {
		t.Fatalf("expected second podcast to continue refreshing, got %d attempts", attempts["/two.xml"])
	}
	if sleepCalls != 3 {
		t.Fatalf("expected three retry sleeps, got %d", sleepCalls)
	}

	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 1`, 0)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 2`, 1)
}

func TestRefreshRejectsConcurrentRefreshForSamePodcast(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		close(requestStarted)
		<-releaseRequest
		return xmlResponse(testRSSFeed("Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	}))

	firstErr := make(chan error, 1)
	go func() {
		_, _, err := service.Refresh(context.Background(), 1)
		firstErr <- err
	}()

	<-requestStarted
	_, _, err := service.Refresh(context.Background(), 1)
	if !errors.Is(err, ErrRefreshAlreadyRunning) {
		t.Fatalf("expected ErrRefreshAlreadyRunning, got %v", err)
	}

	close(releaseRequest)
	if err := <-firstErr; err != nil {
		t.Fatalf("first Refresh failed: %v", err)
	}
}

func TestRefreshAllowsConcurrentRefreshForDifferentPodcasts(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'One', 'https://example.com/one.xml')`)
	mustExecBehavior(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (2, 'Two', 'https://example.com/two.xml')`)

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/one.xml" {
			close(requestStarted)
			<-releaseRequest
			return xmlResponse(testRSSFeed("One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		}
		return xmlResponse(testRSSFeed("Two", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")), nil
	}))

	firstErr := make(chan error, 1)
	go func() {
		_, _, err := service.Refresh(context.Background(), 1)
		firstErr <- err
	}()

	<-requestStarted
	if _, _, err := service.Refresh(context.Background(), 2); err != nil {
		t.Fatalf("expected second podcast refresh to proceed, got %v", err)
	}

	close(releaseRequest)
	if err := <-firstErr; err != nil {
		t.Fatalf("first Refresh failed: %v", err)
	}
}

func TestCreateFromFeedFollowsRedirectsAndSendsFeedHeaders(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := firstCompleteTransistorFixture(t)
	var seenUserAgent string
	var seenAccept string

	server := newTCP4TestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "/feed.xml", http.StatusMovedPermanently)
		case "/feed.xml":
			seenUserAgent = r.Header.Get("User-Agent")
			seenAccept = r.Header.Get("Accept")
			w.Header().Set("Content-Type", "application/rss+xml")
			_, _ = io.WriteString(w, fixture)
		default:
			http.NotFound(w, r)
		}
	}), false)
	defer server.Close()

	service := NewService(db.SQL, server.Client())
	if _, err := service.CreateFromFeed(context.Background(), server.URL+"/redirect"); err != nil {
		t.Fatalf("CreateFromFeed failed: %v", err)
	}
	if seenUserAgent != feedUserAgent {
		t.Fatalf("expected user agent %q, got %q", feedUserAgent, seenUserAgent)
	}
	if seenAccept != feedAccept {
		t.Fatalf("expected accept header %q, got %q", feedAccept, seenAccept)
	}
}

func TestCreateFromFeedParsesGzipResponse(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := firstCompleteTransistorFixture(t)
	server := newTCP4TestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		w.Header().Set("Content-Encoding", "gzip")

		gz := gzip.NewWriter(w)
		defer gz.Close()
		_, _ = io.WriteString(gz, fixture)
	}), false)
	defer server.Close()

	service := NewService(db.SQL, server.Client())
	if _, err := service.CreateFromFeed(context.Background(), server.URL+"/feed.xml"); err != nil {
		t.Fatalf("CreateFromFeed failed for gzip feed: %v", err)
	}
}

func TestCreateFromFeedParsesTLSResponse(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	fixture := firstCompleteTransistorFixture(t)
	server := newTCP4TestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = io.WriteString(w, fixture)
	}), true)
	defer server.Close()

	service := NewService(db.SQL, server.Client())
	if _, err := service.CreateFromFeed(context.Background(), server.URL+"/feed.xml"); err != nil {
		t.Fatalf("CreateFromFeed failed for TLS feed: %v", err)
	}
}

func TestImportOPMLUnexpectedErrorIncludesFeedURL(t *testing.T) {
	db := newBehaviorTestDB(t)
	fixture := firstCompleteTransistorFixture(t)

	if err := db.Close(); err != nil {
		t.Fatalf("db.Close failed: %v", err)
	}

	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return xmlResponse(fixture), nil
	}))

	_, err := service.ImportOPML(context.Background(), strings.NewReader(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Build Your SaaS" xmlUrl="https://feeds.transistor.fm/build-your-saas"/>
  </body>
</opml>`))
	if err == nil {
		t.Fatalf("expected import error from closed database")
	}
	if !strings.Contains(err.Error(), `import feed "https://feeds.transistor.fm/build-your-saas"`) {
		t.Fatalf("expected feed url context in import error, got %v", err)
	}
}

func TestImportOPMLSkipsWrappedFeedFetchFailures(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		return nil, net.ErrClosed
	}))

	result, err := service.ImportOPML(context.Background(), strings.NewReader(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Broken Feed" xmlUrl="https://feeds.feedburner.com/Radio-t"/>
  </body>
</opml>`))
	if err != nil {
		t.Fatalf("expected wrapped fetch failure to be skipped, got %v", err)
	}
	if result.Imported != 0 || result.Skipped != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}
}

func TestImportOPMLWithRealFixturesImportsPlayableAndSkipsHTMLLandingPages(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	transistorFixture := firstCompleteTransistorFixture(t)
	simplecastFixture := readPodcastFixture(t, "simplecast_that_creative_life.html")
	service := NewService(db.SQL, newPodcastTestClient(func(r *http.Request) (*http.Response, error) {
		switch r.URL.String() {
		case "https://feeds.transistor.fm/build-your-saas":
			return xmlResponse(transistorFixture), nil
		case "https://thatcreativelife.simplecast.com":
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Body:       io.NopCloser(strings.NewReader(simplecastFixture)),
				Header:     make(http.Header),
			}
			return resp, nil
		default:
			t.Fatalf("unexpected feed url %q", r.URL.String())
			return nil, nil
		}
	}))

	result, err := service.ImportOPML(context.Background(), strings.NewReader(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Build Your SaaS" xmlUrl="https://feeds.transistor.fm/build-your-saas"/>
    <outline text="That Creative Life" xmlUrl="https://thatcreativelife.simplecast.com"/>
  </body>
</opml>`))
	if err != nil {
		t.Fatalf("ImportOPML failed: %v", err)
	}
	if result.Imported != 1 || result.Skipped != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	assertCount(t, db.SQL, `SELECT COUNT(*) FROM podcasts`, 1)
	assertCount(t, db.SQL, `SELECT COUNT(*) FROM episodes`, 1)
}

func TestImportOPMLRejectsConcurrentImport(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	var startOnce sync.Once
	service := NewService(db.SQL, newPodcastTestClient(func(*http.Request) (*http.Response, error) {
		startOnce.Do(func() { close(requestStarted) })
		<-releaseRequest
		return xmlResponse(testRSSFeed("Podcast", "Episode", "guid-1", "https://cdn.example.com/1.mp3")), nil
	}))
	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body><outline xmlUrl="https://example.com/feed.xml"/></body></opml>`

	firstErr := make(chan error, 1)
	go func() {
		_, err := service.ImportOPML(context.Background(), strings.NewReader(opml))
		firstErr <- err
	}()
	<-requestStarted

	if _, err := service.ImportOPML(context.Background(), strings.NewReader(opml)); err != ErrOPMLImportAlreadyRunning {
		t.Fatalf("expected ErrOPMLImportAlreadyRunning, got %v", err)
	}
	close(releaseRequest)
	if err := <-firstErr; err != nil {
		t.Fatalf("first ImportOPML failed: %v", err)
	}
}

func TestImportOPMLReleasesImportLockAfterValidationError(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, newPodcastTestClient(func(*http.Request) (*http.Response, error) {
		return xmlResponse(testRSSFeed("Podcast", "Episode", "guid-1", "https://cdn.example.com/1.mp3")), nil
	}))
	if _, err := service.ImportOPML(context.Background(), strings.NewReader("not-opml")); err != ErrInvalidOPML {
		t.Fatalf("expected ErrInvalidOPML, got %v", err)
	}

	validOPML := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body><outline xmlUrl="https://example.com/feed.xml"/></body></opml>`
	result, err := service.ImportOPML(context.Background(), strings.NewReader(validOPML))
	if err != nil {
		t.Fatalf("expected next import to proceed, got %v", err)
	}
	if result.Imported != 1 {
		t.Fatalf("expected one imported podcast, got %+v", result)
	}
}

func TestImportOPMLRejectsTooManyFeedsBeforeFetch(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	requestCount := 0
	service := NewService(db.SQL, newPodcastTestClient(func(*http.Request) (*http.Response, error) {
		requestCount++
		return nil, nil
	}))

	var opml strings.Builder
	opml.WriteString(`<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body>`)
	for i := 0; i <= MaxOPMLFeedURLs; i++ {
		opml.WriteString(`<outline xmlUrl="https://example.com/feed-`)
		opml.WriteString(strconv.Itoa(i))
		opml.WriteString(`.xml"/>`)
	}
	opml.WriteString(`</body></opml>`)

	if _, err := service.ImportOPML(context.Background(), strings.NewReader(opml.String())); err != ErrOPMLTooManyFeeds {
		t.Fatalf("expected ErrOPMLTooManyFeeds, got %v", err)
	}
	if requestCount != 0 {
		t.Fatalf("expected feed limit rejection before fetch, got %d requests", requestCount)
	}
}

func newBehaviorTestDB(t *testing.T) *storage.DB {
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

func mustExecBehavior(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func assertCount(t *testing.T, db *sql.DB, query string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	if got != want {
		t.Fatalf("expected count %d, got %d for query %q", want, got, query)
	}
}

func testRSSFeed(title, episodeTitle, guid, audioURL string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>` + title + `</title>
    <item>
      <title>` + episodeTitle + `</title>
      <guid>` + guid + `</guid>
      <enclosure url="` + audioURL + `" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`
}

func testRSSFeedWithTwoEpisodes(title, firstTitle, firstGUID, firstAudioURL, secondTitle, secondGUID, secondAudioURL string) string {
	var builder strings.Builder
	builder.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>`)
	builder.WriteString(title)
	builder.WriteString(`</title>
    <item>
      <title>`)
	builder.WriteString(firstTitle)
	builder.WriteString(`</title>
      <guid>`)
	builder.WriteString(firstGUID)
	builder.WriteString(`</guid>
      <enclosure url="`)
	builder.WriteString(firstAudioURL)
	builder.WriteString(`" type="audio/mpeg"/>
    </item>
    <item>
      <title>`)
	builder.WriteString(secondTitle)
	builder.WriteString(`</title>
      <guid>`)
	builder.WriteString(secondGUID)
	builder.WriteString(`</guid>
      <enclosure url="`)
	builder.WriteString(secondAudioURL)
	builder.WriteString(`" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`)
	return builder.String()
}

func newPodcastTestClient(fn func(*http.Request) (*http.Response, error)) *http.Client {
	return &http.Client{
		Transport: podcastRoundTripperFunc(fn),
	}
}

func newTCP4TestServer(t *testing.T, handler http.Handler, tlsEnabled bool) *httptest.Server {
	t.Helper()

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Skipf("loopback listener unavailable in this environment: %v", err)
	}

	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	if tlsEnabled {
		server.StartTLS()
	} else {
		server.Start()
	}
	return server
}

type podcastRoundTripperFunc func(*http.Request) (*http.Response, error)

func (fn podcastRoundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return fn(r)
}

func xmlResponse(body string) *http.Response {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
	resp.Header.Set("Content-Type", "application/rss+xml")
	return resp
}

func readPodcastFixture(t *testing.T, name string) string {
	t.Helper()

	path := filepath.Join("testdata", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile %q failed: %v", name, err)
	}
	return string(data)
}

func firstCompleteTransistorFixture(t *testing.T) string {
	t.Helper()

	raw := readPodcastFixture(t, "transistor_build_your_saas.xml")
	if !strings.Contains(raw, `uri="at://`) {
		t.Fatalf("expected raw Transistor fixture to include at:// social URI")
	}

	end := strings.Index(raw, "</item>")
	if end == -1 {
		t.Fatalf("expected Transistor fixture to contain a complete first item")
	}

	return raw[:end+len("</item>")] + "\n  </channel>\n</rss>\n"
}
