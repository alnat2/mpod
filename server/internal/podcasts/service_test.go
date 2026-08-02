package podcasts

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"
)

func TestCreateFromFeedRejectsNonHTTPAndCredentialURLsBeforeFetch(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	requestCount := 0
	service := NewService(db.SQL, newPodcastTestClient(func(*http.Request) (*http.Response, error) {
		requestCount++
		return nil, nil
	}))

	for _, rawURL := range []string{
		"file:///etc/passwd",
		"ftp://example.com/feed.xml",
		"https://user:secret@example.com/feed.xml",
	} {
		if _, err := service.CreateFromFeed(context.Background(), rawURL); err != ErrInvalidFeedURL {
			t.Fatalf("expected ErrInvalidFeedURL for %q, got %v", rawURL, err)
		}
	}
	if requestCount != 0 {
		t.Fatalf("expected invalid URLs not to be fetched, got %d requests", requestCount)
	}
}

func TestCollectFeedURLsDeduplicatesNestedOutlines(t *testing.T) {
	outlines := []opmlOutline{
		{
			Text:   "Group",
			Title:  "Group",
			XMLURL: "",
			Outlines: []opmlOutline{
				{XMLURL: "https://example.com/feed.xml"},
				{XMLURL: "https://example.com/feed.xml"},
				{XMLURL: "https://example.com/other.xml"},
			},
		},
	}

	urls := collectFeedURLs(outlines, make(map[string]struct{}))
	if len(urls) != 2 {
		t.Fatalf("expected 2 unique feed urls, got %d: %#v", len(urls), urls)
	}
}

func TestValidateOPMLFeedCountAllowsLimitAndRejectsAboveLimit(t *testing.T) {
	feedURLs := make([]string, MaxOPMLFeedURLs)
	if err := validateOPMLFeedCount(feedURLs); err != nil {
		t.Fatalf("expected %d feeds to be allowed, got %v", MaxOPMLFeedURLs, err)
	}
	feedURLs = append(feedURLs, "https://example.com/overflow.xml")
	if err := validateOPMLFeedCount(feedURLs); err != ErrOPMLTooManyFeeds {
		t.Fatalf("expected ErrOPMLTooManyFeeds above limit, got %v", err)
	}
}

func TestEpisodeFromItemIdentityPriority(t *testing.T) {
	now := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	item := &gofeed.Item{
		Title:           "Episode 1",
		GUID:            "guid-123",
		PublishedParsed: &now,
		Enclosures: []*gofeed.Enclosure{
			{URL: "https://cdn.example.com/episode.mp3"},
		},
	}

	record, ok := episodeFromItem(item)
	if !ok {
		t.Fatalf("expected item to produce an episode record")
	}
	if record.ExternalKey != "guid-123" {
		t.Fatalf("expected guid to be primary identity, got %q", record.ExternalKey)
	}

	item.GUID = ""
	record, ok = episodeFromItem(item)
	if !ok {
		t.Fatalf("expected item to produce an episode record without guid")
	}
	if record.ExternalKey != "https://cdn.example.com/episode.mp3" {
		t.Fatalf("expected audio url to be fallback identity, got %q", record.ExternalKey)
	}
}

func TestUpsertFeedEpisodesCountsDuplicateNewKeyOnce(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()
	mustExecPodcast(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)

	tx, err := db.SQL.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx failed: %v", err)
	}
	items := []*gofeed.Item{
		{
			Title: "First title",
			GUID:  "duplicate-guid",
			Enclosures: []*gofeed.Enclosure{
				{URL: "https://cdn.example.com/first.mp3"},
			},
		},
		{
			Title: "Updated title",
			GUID:  "duplicate-guid",
			Enclosures: []*gofeed.Enclosure{
				{URL: "https://cdn.example.com/updated.mp3"},
			},
		},
	}

	inserted, err := upsertFeedEpisodes(context.Background(), tx, 1, items)
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("upsertFeedEpisodes failed: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit failed: %v", err)
	}
	if inserted != 1 {
		t.Fatalf("expected duplicate new key to count once, got %d", inserted)
	}

	var title string
	if err := db.SQL.QueryRow(`
		SELECT title
		FROM episodes
		WHERE podcast_id = 1 AND external_episode_key = 'duplicate-guid'
	`).Scan(&title); err != nil {
		t.Fatalf("query upserted episode: %v", err)
	}
	assertPodcastCount(t, db.SQL, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 1 AND external_episode_key = 'duplicate-guid'`, 1)
	if title != "Updated title" {
		t.Fatalf("expected updated episode title, got %q", title)
	}
}
