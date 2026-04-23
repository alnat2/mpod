package podcasts

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
