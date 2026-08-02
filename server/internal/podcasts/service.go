package podcasts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cross/mpod/server/internal/remote"
	"github.com/mmcdole/gofeed"
)

var (
	ErrInvalidFeedURL           = errors.New("invalid feed url")
	ErrDuplicateSubscription    = errors.New("podcast already exists")
	ErrFeedFetchFailed          = errors.New("failed to fetch feed")
	ErrFeedParseFailed          = errors.New("failed to parse feed")
	ErrNoPlayableEpisodesFound  = errors.New("feed contains no playable episodes")
	ErrInvalidOPML              = errors.New("invalid opml")
	ErrOPMLImportAlreadyRunning = errors.New("opml import already running")
	ErrOPMLTooManyFeeds         = errors.New("opml contains too many feeds")
	ErrPodcastNotFound          = errors.New("podcast not found")
	ErrRefreshAlreadyRunning    = errors.New("podcast refresh already running")
)

const (
	feedUserAgent   = "mpod/1.0 (+self-hosted podcast client)"
	feedAccept      = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
	MaxOPMLFeedURLs = 1000
)

var unsupportedFeedURIAttrPattern = regexp.MustCompile(`\buri="at://[^"]*"`)

type Service struct {
	db          *sql.DB
	client      *http.Client
	parser      *gofeed.Parser
	retryDelays []time.Duration
	sleep       func(context.Context, time.Duration) error
	refreshMu   sync.Mutex
	refreshing  map[int64]struct{}
	importMu    sync.Mutex
	importing   bool
}

type Podcast struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	ImageURL    *string    `json:"imageUrl,omitempty"`
	RSSURL      string     `json:"rssUrl"`
	LastChecked *time.Time `json:"lastChecked"`
	UpdateTime  *string    `json:"updateTime"`
}

func NewService(db *sql.DB, client *http.Client) *Service {
	return &Service{
		db:     db,
		client: client,
		parser: gofeed.NewParser(),
		retryDelays: []time.Duration{
			30 * time.Second,
			2 * time.Minute,
			5 * time.Minute,
		},
		sleep:      sleepContext,
		refreshing: make(map[int64]struct{}),
	}
}

func (s *Service) List(ctx context.Context) ([]Podcast, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, title, description, image_url, rss_url, last_checked, update_time
		FROM podcasts
		ORDER BY lower(title) ASC, id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list podcasts: %w", err)
	}
	defer rows.Close()

	podcasts := make([]Podcast, 0)
	for rows.Next() {
		podcast, err := scanPodcast(rows)
		if err != nil {
			return nil, fmt.Errorf("scan podcast: %w", err)
		}
		podcasts = append(podcasts, podcast)
	}

	return podcasts, rows.Err()
}

func (s *Service) GetByID(ctx context.Context, podcastID int64) (Podcast, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, title, description, image_url, rss_url, last_checked, update_time
		FROM podcasts
		WHERE id = ?
	`, podcastID)
	podcast, err := scanPodcast(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Podcast{}, ErrPodcastNotFound
		}
		return Podcast{}, fmt.Errorf("get podcast: %w", err)
	}
	return podcast, nil
}

func (s *Service) CreateFromFeed(ctx context.Context, rawURL string) (Podcast, error) {
	normalizedURL, err := normalizeFeedURL(rawURL)
	if err != nil {
		return Podcast{}, ErrInvalidFeedURL
	}

	feed, err := s.fetchFeed(ctx, normalizedURL)
	if err != nil {
		return Podcast{}, err
	}
	podcast, _, err := s.createPodcastFromFeed(ctx, normalizedURL, feed)
	return podcast, err
}

func (s *Service) Refresh(ctx context.Context, podcastID int64) (int, time.Time, error) {
	podcast, err := s.GetByID(ctx, podcastID)
	if err != nil {
		return 0, time.Time{}, err
	}
	if !s.beginRefresh(podcastID) {
		return 0, time.Time{}, ErrRefreshAlreadyRunning
	}
	defer s.endRefresh(podcastID)

	feed, err := s.fetchFeed(ctx, podcast.RSSURL)
	if err != nil {
		return 0, time.Time{}, err
	}
	return s.refreshPodcastFromFeed(ctx, podcastID, podcast.RSSURL, feed)
}

func (s *Service) RefreshAll(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM podcasts ORDER BY id ASC`)
	if err != nil {
		return fmt.Errorf("list podcasts for refresh: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan podcast id for refresh: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	var failures []error
	for _, id := range ids {
		if err := s.refreshWithRetry(ctx, id); err != nil {
			failures = append(failures, fmt.Errorf("podcast %d: %w", id, err))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("refresh failures: %w", errors.Join(failures...))
	}
	return nil
}

func (s *Service) refreshWithRetry(ctx context.Context, podcastID int64) error {
	var lastErr error
	attempts := len(s.retryDelays) + 1
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			if err := s.sleep(ctx, s.retryDelays[attempt-1]); err != nil {
				return err
			}
		}
		if _, _, err := s.Refresh(ctx, podcastID); err != nil {
			if errors.Is(err, ErrRefreshAlreadyRunning) {
				return err
			}
			lastErr = err
			continue
		}
		return nil
	}
	return lastErr
}

func (s *Service) beginRefresh(podcastID int64) bool {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()

	if _, ok := s.refreshing[podcastID]; ok {
		return false
	}
	s.refreshing[podcastID] = struct{}{}
	return true
}

func (s *Service) endRefresh(podcastID int64) {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()

	delete(s.refreshing, podcastID)
}

func (s *Service) Delete(ctx context.Context, podcastID int64) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT downloaded_path
		FROM episodes
		WHERE podcast_id = ? AND downloaded_path IS NOT NULL AND downloaded_path <> ''
	`, podcastID)
	if err != nil {
		return fmt.Errorf("load podcast download paths: %w", err)
	}
	defer rows.Close()

	var files []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return fmt.Errorf("scan podcast download path: %w", err)
		}
		files = append(files, path)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, path := range files {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("delete podcast download: %w", err)
		}
	}

	result, err := s.db.ExecContext(ctx, `DELETE FROM podcasts WHERE id = ?`, podcastID)
	if err != nil {
		return fmt.Errorf("delete podcast: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check podcast delete rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return ErrPodcastNotFound
	}

	for _, path := range files {
		_ = os.Remove(filepath.Dir(path))
	}
	return nil
}

func (s *Service) fetchFeed(ctx context.Context, normalizedURL string) (*gofeed.Feed, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalizedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build feed request: %w", err)
	}
	req.Header.Set("User-Agent", feedUserAgent)
	req.Header.Set("Accept", feedAccept)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFeedFetchFailed, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status=%s", ErrFeedFetchFailed, resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %v", ErrFeedFetchFailed, err)
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if looksLikeHTMLResponse(contentType, body) {
		return nil, fmt.Errorf("%w: content-type=%q preview=%q", ErrFeedParseFailed, contentType, bodyPreview(body))
	}

	sanitizedBody := sanitizeUnsupportedFeedURIs(body)
	feed, err := s.parser.Parse(bytes.NewReader(sanitizedBody))
	if err != nil {
		return nil, fmt.Errorf("%w: content-type=%q parse=%v preview=%q", ErrFeedParseFailed, contentType, err, bodyPreview(body))
	}
	return feed, nil
}

func looksLikeHTMLResponse(contentType string, body []byte) bool {
	lowerType := strings.ToLower(contentType)
	if strings.Contains(lowerType, "text/html") || strings.Contains(lowerType, "application/xhtml+xml") {
		return true
	}

	trimmed := strings.ToLower(strings.TrimSpace(string(body)))
	return strings.HasPrefix(trimmed, "<!doctype html") || strings.HasPrefix(trimmed, "<html")
}

func bodyPreview(body []byte) string {
	preview := strings.TrimSpace(strings.ToValidUTF8(string(body), ""))
	preview = strings.NewReplacer("\n", " ", "\r", " ", "\t", " ").Replace(preview)
	if len(preview) > 120 {
		return preview[:120]
	}
	return preview
}

func sanitizeUnsupportedFeedURIs(body []byte) []byte {
	return unsupportedFeedURIAttrPattern.ReplaceAll(body, []byte(`uri=""`))
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) createPodcastFromFeed(ctx context.Context, normalizedURL string, feed *gofeed.Feed) (Podcast, int, error) {
	podcast := Podcast{
		Title:    choosePodcastTitle(feed, normalizedURL),
		RSSURL:   normalizedURL,
		ImageURL: chooseImageURL(feed),
	}

	if description := nullableString(feed.Description); description != nil {
		podcast.Description = description
	}

	now := time.Now().UTC()
	podcast.LastChecked = &now

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Podcast{}, 0, fmt.Errorf("begin podcast create tx: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO podcasts (title, description, image_url, rss_url, last_checked, update_time)
		VALUES (?, ?, ?, ?, ?, NULL)
	`, podcast.Title, podcast.Description, podcast.ImageURL, podcast.RSSURL, now)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Podcast{}, 0, ErrDuplicateSubscription
		}
		return Podcast{}, 0, fmt.Errorf("insert podcast: %w", err)
	}

	podcastID, err := result.LastInsertId()
	if err != nil {
		return Podcast{}, 0, fmt.Errorf("load podcast id: %w", err)
	}
	podcast.ID = podcastID

	insertedEpisodes, err := upsertFeedEpisodes(ctx, tx, podcastID, feed.Items)
	if err != nil {
		return Podcast{}, 0, err
	}

	if insertedEpisodes == 0 {
		return Podcast{}, 0, ErrNoPlayableEpisodesFound
	}

	if err := tx.Commit(); err != nil {
		return Podcast{}, 0, fmt.Errorf("commit podcast create: %w", err)
	}

	return podcast, insertedEpisodes, nil
}

func (s *Service) refreshPodcastFromFeed(ctx context.Context, podcastID int64, feedURL string, feed *gofeed.Feed) (int, time.Time, error) {
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("begin refresh tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE podcasts
		SET title = ?, description = ?, image_url = ?, rss_url = ?, last_checked = ?
		WHERE id = ?
	`, choosePodcastTitle(feed, feedURL), nullableStringValue(feed.Description), chooseImageURLValue(feed), feedURL, now, podcastID); err != nil {
		return 0, time.Time{}, fmt.Errorf("update podcast during refresh: %w", err)
	}

	insertedEpisodes, err := upsertFeedEpisodes(ctx, tx, podcastID, feed.Items)
	if err != nil {
		return 0, time.Time{}, err
	}
	if err := tx.Commit(); err != nil {
		return 0, time.Time{}, fmt.Errorf("commit refresh: %w", err)
	}
	return insertedEpisodes, now, nil
}

type ImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

func (s *Service) ImportOPML(ctx context.Context, reader io.Reader) (ImportResult, error) {
	if !s.beginOPMLImport() {
		return ImportResult{}, ErrOPMLImportAlreadyRunning
	}
	defer s.endOPMLImport()

	var document opmlDocument
	if err := xml.NewDecoder(reader).Decode(&document); err != nil {
		return ImportResult{}, ErrInvalidOPML
	}

	feedURLs := collectFeedURLs(document.Body.Outlines, make(map[string]struct{}))
	if len(feedURLs) == 0 {
		return ImportResult{}, ErrInvalidOPML
	}
	if err := validateOPMLFeedCount(feedURLs); err != nil {
		return ImportResult{}, err
	}

	result := ImportResult{}
	for _, feedURL := range feedURLs {
		if _, err := s.CreateFromFeed(ctx, feedURL); err != nil {
			switch {
			case errors.Is(err, ErrDuplicateSubscription),
				errors.Is(err, ErrInvalidFeedURL),
				errors.Is(err, ErrFeedFetchFailed),
				errors.Is(err, ErrFeedParseFailed),
				errors.Is(err, ErrNoPlayableEpisodesFound):
				result.Skipped++
			default:
				return ImportResult{}, fmt.Errorf("import feed %q: %w", feedURL, err)
			}
			continue
		}
		result.Imported++
	}

	return result, nil
}

func (s *Service) beginOPMLImport() bool {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	if s.importing {
		return false
	}
	s.importing = true
	return true
}

func (s *Service) endOPMLImport() {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	s.importing = false
}

func validateOPMLFeedCount(feedURLs []string) error {
	if len(feedURLs) > MaxOPMLFeedURLs {
		return ErrOPMLTooManyFeeds
	}
	return nil
}

func (s *Service) ExportOPML(ctx context.Context) ([]byte, error) {
	podcastList, err := s.List(ctx)
	if err != nil {
		return nil, err
	}

	outlines := make([]opmlOutline, 0, len(podcastList))
	for _, podcast := range podcastList {
		outlines = append(outlines, opmlOutline{
			Text:    podcast.Title,
			Title:   podcast.Title,
			Type:    "rss",
			XMLURL:  podcast.RSSURL,
			HTMLURL: "",
		})
	}

	document := opmlDocument{
		Version: "2.0",
		Head: opmlHead{
			Title: "mpod subscriptions",
		},
		Body: opmlBody{
			Outlines: outlines,
		},
	}

	payload, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal opml: %w", err)
	}

	return append([]byte(xml.Header), payload...), nil
}

type opmlDocument struct {
	XMLName xml.Name `xml:"opml"`
	Version string   `xml:"version,attr"`
	Head    opmlHead `xml:"head"`
	Body    opmlBody `xml:"body"`
}

type opmlHead struct {
	Title string `xml:"title"`
}

type opmlBody struct {
	Outlines []opmlOutline `xml:"outline"`
}

type opmlOutline struct {
	Text     string        `xml:"text,attr,omitempty"`
	Title    string        `xml:"title,attr,omitempty"`
	Type     string        `xml:"type,attr,omitempty"`
	XMLURL   string        `xml:"xmlUrl,attr,omitempty"`
	HTMLURL  string        `xml:"htmlUrl,attr,omitempty"`
	Outlines []opmlOutline `xml:"outline,omitempty"`
}

func collectFeedURLs(outlines []opmlOutline, seen map[string]struct{}) []string {
	var result []string
	for _, outline := range outlines {
		if outline.XMLURL != "" {
			normalized, err := normalizeFeedURL(outline.XMLURL)
			if err == nil {
				if _, exists := seen[normalized]; !exists {
					seen[normalized] = struct{}{}
					result = append(result, normalized)
				}
			}
		}
		if len(outline.Outlines) > 0 {
			result = append(result, collectFeedURLs(outline.Outlines, seen)...)
		}
	}
	return result
}

type episodeRecord struct {
	ExternalKey string
	Title       string
	Description *string
	GUID        *string
	AudioURL    string
	Duration    *int64
	PublishedAt *time.Time
}

func episodeFromItem(item *gofeed.Item) (episodeRecord, bool) {
	audioURL := firstAudioURL(item)
	if audioURL == "" {
		return episodeRecord{}, false
	}

	title := strings.TrimSpace(item.Title)
	if title == "" {
		title = "Untitled Episode"
	}

	externalKey := strings.TrimSpace(item.GUID)
	if externalKey == "" {
		externalKey = audioURL
	}
	if externalKey == "" {
		externalKey = fallbackExternalKey(title, item.PublishedParsed)
	}
	if externalKey == "" {
		return episodeRecord{}, false
	}

	return episodeRecord{
		ExternalKey: externalKey,
		Title:       title,
		Description: nullableString(item.Description),
		GUID:        nullableString(item.GUID),
		AudioURL:    audioURL,
		Duration:    parseDuration(item),
		PublishedAt: item.PublishedParsed,
	}, true
}

func firstAudioURL(item *gofeed.Item) string {
	for _, enclosure := range item.Enclosures {
		if strings.TrimSpace(enclosure.URL) != "" {
			return strings.TrimSpace(enclosure.URL)
		}
	}
	return ""
}

func parseDuration(item *gofeed.Item) *int64 {
	if item.ITunesExt == nil {
		return nil
	}

	value := strings.TrimSpace(item.ITunesExt.Duration)
	if value == "" {
		return nil
	}

	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		return &seconds
	}

	parts := strings.Split(value, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return nil
	}

	var total int64
	for _, part := range parts {
		n, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			return nil
		}
		total = total*60 + n
	}
	return &total
}

func fallbackExternalKey(title string, publishedAt *time.Time) string {
	title = strings.TrimSpace(strings.ToLower(title))
	if publishedAt == nil {
		return ""
	}
	return title + "-" + publishedAt.UTC().Format(time.RFC3339)
}

func choosePodcastTitle(feed *gofeed.Feed, feedURL string) string {
	if title := strings.TrimSpace(feed.Title); title != "" {
		return title
	}
	if parsed, err := url.Parse(feedURL); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return feedURL
}

func chooseImageURL(feed *gofeed.Feed) *string {
	if feed.Image != nil && strings.TrimSpace(feed.Image.URL) != "" {
		value := strings.TrimSpace(feed.Image.URL)
		return &value
	}
	if feed.ITunesExt != nil && strings.TrimSpace(feed.ITunesExt.Image) != "" {
		value := strings.TrimSpace(feed.ITunesExt.Image)
		return &value
	}
	return nil
}

func chooseImageURLValue(feed *gofeed.Feed) any {
	if value := chooseImageURL(feed); value != nil {
		return *value
	}
	return nil
}

func nullableString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullableStringValue(value string) any {
	if out := nullableString(value); out != nil {
		return *out
	}
	return nil
}

func normalizeFeedURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || remote.ValidateHTTPURL(parsed) != nil {
		return "", ErrInvalidFeedURL
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Fragment = ""
	return parsed.String(), nil
}

type podcastScanner interface {
	Scan(dest ...any) error
}

func scanPodcast(row podcastScanner) (Podcast, error) {
	var podcast Podcast
	var description sql.NullString
	var imageURL sql.NullString
	var lastChecked sql.NullTime
	var updateTime sql.NullString

	if err := row.Scan(
		&podcast.ID,
		&podcast.Title,
		&description,
		&imageURL,
		&podcast.RSSURL,
		&lastChecked,
		&updateTime,
	); err != nil {
		return Podcast{}, err
	}

	if description.Valid {
		podcast.Description = &description.String
	}
	if imageURL.Valid {
		podcast.ImageURL = &imageURL.String
	}
	if lastChecked.Valid {
		ts := lastChecked.Time.UTC()
		podcast.LastChecked = &ts
	}
	if updateTime.Valid {
		podcast.UpdateTime = &updateTime.String
	}

	return podcast, nil
}

func upsertFeedEpisodes(ctx context.Context, tx *sql.Tx, podcastID int64, items []*gofeed.Item) (int, error) {
	existingKeys, err := loadExistingEpisodeKeys(ctx, tx, podcastID)
	if err != nil {
		return 0, err
	}

	insertedEpisodes := 0
	for _, item := range items {
		episode, ok := episodeFromItem(item)
		if !ok {
			continue
		}

		if _, err := tx.ExecContext(ctx, `
				INSERT INTO episodes (
					podcast_id,
					external_episode_key,
				title,
				description,
				guid,
				audio_url,
				duration,
				published_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (podcast_id, external_episode_key) DO UPDATE SET
				title = excluded.title,
				description = excluded.description,
				guid = excluded.guid,
				audio_url = excluded.audio_url,
				duration = excluded.duration,
				published_at = excluded.published_at
			`, podcastID, episode.ExternalKey, episode.Title, episode.Description, episode.GUID, episode.AudioURL, episode.Duration, episode.PublishedAt); err != nil {
			return 0, fmt.Errorf("insert episode: %w", err)
		}
		if _, exists := existingKeys[episode.ExternalKey]; !exists {
			insertedEpisodes++
			existingKeys[episode.ExternalKey] = struct{}{}
		}
	}
	return insertedEpisodes, nil
}

func loadExistingEpisodeKeys(ctx context.Context, tx *sql.Tx, podcastID int64) (map[string]struct{}, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT external_episode_key
		FROM episodes
		WHERE podcast_id = ?
	`, podcastID)
	if err != nil {
		return nil, fmt.Errorf("load existing episode keys: %w", err)
	}
	defer rows.Close()

	keys := make(map[string]struct{})
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, fmt.Errorf("scan existing episode key: %w", err)
		}
		keys[key] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate existing episode keys: %w", err)
	}
	return keys, nil
}
