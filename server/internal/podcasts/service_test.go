package podcasts

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
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

func TestCreateFromFeedWithoutDirectClientReturnsFetchError(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	proxyAttempts := 0
	service := NewService(db.SQL, newPodcastTestClient(func(*http.Request) (*http.Response, error) {
		proxyAttempts++
		return nil, errors.New("TLS handshake timeout")
	}))

	_, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if !errors.Is(err, ErrFeedFetchFailed) {
		t.Fatalf("expected feed fetch error, got %v", err)
	}
	if proxyAttempts != 1 {
		t.Fatalf("expected one request when no direct client is configured, got %d", proxyAttempts)
	}
}

func TestCreateFromFeedRetriesProxyThenFallsBackDirect(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	proxyAttempts := 0
	directAttempts := 0
	proxyRetryPauses := 0
	service := NewServiceWithDirectFallback(
		db.SQL,
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			proxyAttempts++
			return nil, errors.New("TLS handshake timeout")
		}),
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			directAttempts++
			return xmlResponse(testRSSFeed("Fallback Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		}),
		func(context.Context) bool { return true },
	)
	service.sleep = func(_ context.Context, delay time.Duration) error {
		proxyRetryPauses++
		if delay != feedProxyRetryDelay {
			t.Fatalf("expected %s proxy retry delay, got %s", feedProxyRetryDelay, delay)
		}
		return nil
	}

	podcast, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if err != nil {
		t.Fatalf("CreateFromFeed failed after direct fallback: %v", err)
	}
	if podcast.Title != "Fallback Podcast" {
		t.Fatalf("expected direct feed title, got %q", podcast.Title)
	}
	if proxyAttempts != feedProxyAttempts {
		t.Fatalf("expected %d proxied attempts, got %d", feedProxyAttempts, proxyAttempts)
	}
	if directAttempts != 1 {
		t.Fatalf("expected one direct attempt, got %d", directAttempts)
	}
	if proxyRetryPauses != 1 {
		t.Fatalf("expected one pause between proxy attempts, got %d", proxyRetryPauses)
	}
}

func TestCreateFromFeedFallsBackDirectAfterProxyHTTPFailure(t *testing.T) {
	for _, statusCode := range []int{http.StatusForbidden, http.StatusBadGateway} {
		t.Run(http.StatusText(statusCode), func(t *testing.T) {
			db := newBehaviorTestDB(t)
			defer db.Close()

			proxyAttempts := 0
			directAttempts := 0
			service := NewServiceWithDirectFallback(
				db.SQL,
				newPodcastTestClient(func(*http.Request) (*http.Response, error) {
					proxyAttempts++
					return &http.Response{
						StatusCode: statusCode,
						Status:     http.StatusText(statusCode),
						Body:       io.NopCloser(strings.NewReader("proxy error")),
						Header:     make(http.Header),
					}, nil
				}),
				newPodcastTestClient(func(*http.Request) (*http.Response, error) {
					directAttempts++
					return xmlResponse(testRSSFeed("Fallback Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
				}),
				func(context.Context) bool { return true },
			)
			service.sleep = func(context.Context, time.Duration) error { return nil }

			if _, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml"); err != nil {
				t.Fatalf("CreateFromFeed failed after direct fallback: %v", err)
			}
			if proxyAttempts != feedProxyAttempts {
				t.Fatalf("expected %d proxy attempts, got %d", feedProxyAttempts, proxyAttempts)
			}
			if directAttempts != 1 {
				t.Fatalf("expected one direct attempt, got %d", directAttempts)
			}
		})
	}
}

func TestCreateFromFeedCancellationDuringProxyRetrySkipsDirectFallback(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	proxyAttempts := 0
	directAttempts := 0
	service := NewServiceWithDirectFallback(
		db.SQL,
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			proxyAttempts++
			return nil, errors.New("TLS handshake timeout")
		}),
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			directAttempts++
			return xmlResponse(testRSSFeed("Fallback Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		}),
		func(context.Context) bool { return true },
	)
	service.sleep = func(ctx context.Context, delay time.Duration) error {
		if delay != feedProxyRetryDelay {
			t.Fatalf("expected %s proxy retry delay, got %s", feedProxyRetryDelay, delay)
		}
		cancel()
		return ctx.Err()
	}

	_, err := service.CreateFromFeed(ctx, "https://example.com/feed.xml")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled context error, got %v", err)
	}
	if proxyAttempts != 1 {
		t.Fatalf("expected one proxy attempt before cancellation, got %d", proxyAttempts)
	}
	if directAttempts != 0 {
		t.Fatalf("expected cancellation to prevent direct fallback, got %d direct attempts", directAttempts)
	}
}

func TestCreateFromFeedDoesNotUseDirectFallbackWhenProxyDisabled(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	proxyAttempts := 0
	directAttempts := 0
	service := NewServiceWithDirectFallback(
		db.SQL,
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			proxyAttempts++
			return nil, errors.New("TLS handshake timeout")
		}),
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			directAttempts++
			return xmlResponse(testRSSFeed("Fallback Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		}),
		func(context.Context) bool { return false },
	)

	_, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if err == nil || !strings.Contains(err.Error(), "TLS handshake timeout") {
		t.Fatalf("expected proxy fetch error, got %v", err)
	}
	if proxyAttempts != 1 {
		t.Fatalf("expected one request with proxy disabled, got %d", proxyAttempts)
	}
	if directAttempts != 0 {
		t.Fatalf("expected no extra direct request when proxy is disabled, got %d", directAttempts)
	}
}

func TestCreateFromFeedDoesNotUseDirectFallbackForMalformedFeed(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	directAttempts := 0
	service := NewServiceWithDirectFallback(
		db.SQL,
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			return xmlResponse("<not-rss/>"), nil
		}),
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			directAttempts++
			return xmlResponse(testRSSFeed("Fallback Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		}),
		func(context.Context) bool { return true },
	)

	_, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if !errors.Is(err, ErrFeedParseFailed) {
		t.Fatalf("expected feed parse error, got %v", err)
	}
	if directAttempts != 0 {
		t.Fatalf("expected malformed feed not to trigger direct fallback, got %d requests", directAttempts)
	}
}

func TestCreateFromFeedReturnsGenericErrorWhenProxyAndDirectFetchFail(t *testing.T) {
	db := newBehaviorTestDB(t)
	defer db.Close()

	proxyAttempts := 0
	directAttempts := 0
	service := NewServiceWithDirectFallback(
		db.SQL,
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			proxyAttempts++
			return nil, errors.New("proxy TLS handshake timeout")
		}),
		newPodcastTestClient(func(*http.Request) (*http.Response, error) {
			directAttempts++
			return nil, errors.New("direct connection refused")
		}),
		func(context.Context) bool { return true },
	)
	service.sleep = func(context.Context, time.Duration) error { return nil }

	_, err := service.CreateFromFeed(context.Background(), "https://example.com/feed.xml")
	if !errors.Is(err, ErrFeedFetchFailed) {
		t.Fatalf("expected feed fetch error, got %v", err)
	}
	if strings.Contains(err.Error(), "proxy TLS handshake timeout") || strings.Contains(err.Error(), "direct connection refused") {
		t.Fatalf("expected route-specific errors to stay private, got %v", err)
	}
	if proxyAttempts != feedProxyAttempts || directAttempts != 1 {
		t.Fatalf("expected proxy/direct requests %d/1, got %d/%d", feedProxyAttempts, proxyAttempts, directAttempts)
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
