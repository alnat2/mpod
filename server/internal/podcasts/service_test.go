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
