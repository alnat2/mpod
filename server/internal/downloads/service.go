package downloads

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/cross/mpod/server/internal/media"
)

var (
	ErrEpisodeNotFound = errors.New("episode not found")
)

type Service struct {
	db           *sql.DB
	client       *http.Client
	downloadsDir string
	mu           sync.Mutex
	inFlight     map[int64]*downloadCall
}

type downloadCall struct {
	done   chan struct{}
	cancel context.CancelFunc
	result EpisodeDownload
	err    error
}

type EpisodeDownload struct {
	ID         int64 `json:"id"`
	Downloaded bool  `json:"downloaded"`
}

const downloadTimeout = 10 * time.Minute

func NewService(db *sql.DB, client *http.Client, downloadsDir string) *Service {
	return &Service{
		db:           db,
		client:       client,
		downloadsDir: downloadsDir,
		inFlight:     make(map[int64]*downloadCall),
	}
}

func (s *Service) Download(ctx context.Context, episodeID int64) (EpisodeDownload, error) {
	s.mu.Lock()
	if call := s.inFlight[episodeID]; call != nil {
		s.mu.Unlock()
		select {
		case <-call.done:
			return call.result, call.err
		case <-ctx.Done():
			return EpisodeDownload{}, ctx.Err()
		}
	}

	downloadCtx, cancel := context.WithCancel(ctx)
	call := &downloadCall{done: make(chan struct{}), cancel: cancel}
	s.inFlight[episodeID] = call
	s.mu.Unlock()

	call.result, call.err = s.download(downloadCtx, episodeID)
	cancel()

	s.mu.Lock()
	delete(s.inFlight, episodeID)
	close(call.done)
	s.mu.Unlock()
	return call.result, call.err
}

func (s *Service) download(ctx context.Context, episodeID int64) (EpisodeDownload, error) {
	meta, err := s.loadEpisodeMeta(ctx, episodeID)
	if err != nil {
		return EpisodeDownload{}, err
	}

	if meta.DownloadedPath.Valid && meta.DownloadedPath.String != "" {
		if _, err := os.Stat(meta.DownloadedPath.String); err == nil {
			return EpisodeDownload{ID: episodeID, Downloaded: true}, nil
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE episodes SET downloaded_path = NULL WHERE id = ?`, episodeID); err != nil {
			return EpisodeDownload{}, fmt.Errorf("clear stale downloaded_path: %w", err)
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, meta.AudioURL, nil)
	if err != nil {
		return EpisodeDownload{}, fmt.Errorf("build download request: %w", err)
	}

	baseClient := s.client
	if baseClient == nil {
		baseClient = http.DefaultClient
	}
	client := *baseClient
	client.Timeout = downloadTimeout

	resp, err := client.Do(req)
	if err != nil {
		return EpisodeDownload{}, fmt.Errorf("download audio: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return EpisodeDownload{}, fmt.Errorf("download audio status: %s", resp.Status)
	}
	if !media.IsPlayableContentType(resp.Header.Get("Content-Type")) {
		return EpisodeDownload{}, fmt.Errorf("download audio content type: %s", resp.Header.Get("Content-Type"))
	}
	prefix, err := media.ReadBodyPrefix(resp.Body)
	if err != nil {
		return EpisodeDownload{}, fmt.Errorf("read audio prefix: %w", err)
	}
	if media.LooksLikeNonPlayableBody(prefix) {
		return EpisodeDownload{}, fmt.Errorf("download audio body is not playable")
	}

	targetDir := filepath.Join(s.downloadsDir, fmt.Sprintf("%d", meta.PodcastID))
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return EpisodeDownload{}, fmt.Errorf("create download directory: %w", err)
	}

	targetPath := filepath.Join(targetDir, buildFilename(meta.ID, meta.Title, meta.AudioURL))
	tmpPath := targetPath + ".tmp"

	file, err := os.Create(tmpPath)
	if err != nil {
		return EpisodeDownload{}, fmt.Errorf("create temp download file: %w", err)
	}

	written, copyErr := io.Copy(file, io.MultiReader(bytes.NewReader(prefix), resp.Body))
	if copyErr == nil {
		copyErr = file.Sync()
	}
	if closeErr := file.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, fmt.Errorf("write audio file: %w", copyErr)
	}
	if ctx.Err() != nil {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, ctx.Err()
	}
	if resp.ContentLength > 0 && written != resp.ContentLength {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, fmt.Errorf("download audio incomplete: wrote %d of %d bytes", written, resp.ContentLength)
	}

	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, fmt.Errorf("move audio file into place: %w", err)
	}

	if _, err := s.db.ExecContext(ctx, `UPDATE episodes SET downloaded_path = ? WHERE id = ?`, targetPath, episodeID); err != nil {
		_ = os.Remove(targetPath)
		return EpisodeDownload{}, fmt.Errorf("save downloaded_path: %w", err)
	}

	return EpisodeDownload{ID: episodeID, Downloaded: true}, nil
}

func (s *Service) Delete(ctx context.Context, episodeID int64) (EpisodeDownload, error) {
	if err := s.cancelDownload(ctx, episodeID); err != nil {
		return EpisodeDownload{}, fmt.Errorf("cancel episode download: %w", err)
	}

	meta, err := s.loadEpisodeMeta(ctx, episodeID)
	if err != nil {
		return EpisodeDownload{}, err
	}

	if meta.DownloadedPath.Valid && meta.DownloadedPath.String != "" {
		if err := os.Remove(meta.DownloadedPath.String); err != nil && !errors.Is(err, os.ErrNotExist) {
			return EpisodeDownload{}, fmt.Errorf("delete downloaded file: %w", err)
		}
	}

	if _, err := s.db.ExecContext(ctx, `UPDATE episodes SET downloaded_path = NULL WHERE id = ?`, episodeID); err != nil {
		return EpisodeDownload{}, fmt.Errorf("clear downloaded_path: %w", err)
	}

	return EpisodeDownload{ID: episodeID, Downloaded: false}, nil
}

func (s *Service) cancelDownload(ctx context.Context, episodeID int64) error {
	s.mu.Lock()
	call := s.inFlight[episodeID]
	if call != nil {
		call.cancel()
	}
	s.mu.Unlock()
	if call == nil {
		return nil
	}

	select {
	case <-call.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) CleanupPartialFiles() error {
	return filepath.WalkDir(s.downloadsDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tmp") {
			return nil
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove partial download %q: %w", path, err)
		}
		return nil
	})
}

type episodeMeta struct {
	ID             int64
	PodcastID      int64
	Title          string
	AudioURL       string
	DownloadedPath sql.NullString
}

func (s *Service) loadEpisodeMeta(ctx context.Context, episodeID int64) (episodeMeta, error) {
	var meta episodeMeta
	err := s.db.QueryRowContext(ctx, `
		SELECT id, podcast_id, title, audio_url, downloaded_path
		FROM episodes
		WHERE id = ?
	`, episodeID).Scan(&meta.ID, &meta.PodcastID, &meta.Title, &meta.AudioURL, &meta.DownloadedPath)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return episodeMeta{}, ErrEpisodeNotFound
		}
		return episodeMeta{}, fmt.Errorf("load episode: %w", err)
	}
	return meta, nil
}

func (s *Service) GetLocalPath(ctx context.Context, episodeID int64) (string, error) {
	meta, err := s.loadEpisodeMeta(ctx, episodeID)
	if err != nil {
		return "", err
	}
	if meta.DownloadedPath.Valid && meta.DownloadedPath.String != "" {
		if _, err := os.Stat(meta.DownloadedPath.String); err == nil {
			playable, err := localFileLooksPlayable(meta.DownloadedPath.String)
			if err != nil {
				return "", fmt.Errorf("check local audio: %w", err)
			}
			if !playable {
				if _, err := s.db.ExecContext(ctx, `UPDATE episodes SET downloaded_path = NULL WHERE id = ?`, episodeID); err != nil {
					return "", fmt.Errorf("clear non-playable downloaded_path: %w", err)
				}
				return "", nil
			}
			return meta.DownloadedPath.String, nil
		}
	}
	return "", nil
}

func localFileLooksPlayable(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()

	prefix, err := media.ReadBodyPrefix(file)
	if err != nil {
		return false, err
	}
	return !media.LooksLikeNonPlayableBody(prefix), nil
}

var invalidFilenameChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func buildFilename(id int64, title, audioURL string) string {
	safeTitle := invalidFilenameChars.ReplaceAllString(strings.TrimSpace(title), "-")
	safeTitle = strings.Trim(safeTitle, "-")
	if safeTitle == "" {
		safeTitle = "episode"
	}
	ext := fileExtension(audioURL)
	return fmt.Sprintf("%d-%s%s", id, safeTitle, ext)
}

func fileExtension(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	ext := filepath.Ext(parsed.Path)
	if len(ext) > 10 {
		return ""
	}
	return ext
}
