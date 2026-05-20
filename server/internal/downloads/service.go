package downloads

import (
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
)

var (
	ErrEpisodeNotFound = errors.New("episode not found")
)

type Service struct {
	db           *sql.DB
	client       *http.Client
	downloadsDir string
}

type EpisodeDownload struct {
	ID         int64 `json:"id"`
	Downloaded bool  `json:"downloaded"`
}

func NewService(db *sql.DB, client *http.Client, downloadsDir string) *Service {
	return &Service{
		db:           db,
		client:       client,
		downloadsDir: downloadsDir,
	}
}

func (s *Service) Download(ctx context.Context, episodeID int64) (EpisodeDownload, error) {
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

	resp, err := s.client.Do(req)
	if err != nil {
		return EpisodeDownload{}, fmt.Errorf("download audio: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return EpisodeDownload{}, fmt.Errorf("download audio status: %s", resp.Status)
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

	copyErr := func() error {
		defer file.Close()
		_, err := io.Copy(file, resp.Body)
		return err
	}()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, fmt.Errorf("write audio file: %w", copyErr)
	}

	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return EpisodeDownload{}, fmt.Errorf("move audio file into place: %w", err)
	}

	if _, err := s.db.ExecContext(ctx, `UPDATE episodes SET downloaded_path = ? WHERE id = ?`, targetPath, episodeID); err != nil {
		return EpisodeDownload{}, fmt.Errorf("save downloaded_path: %w", err)
	}

	return EpisodeDownload{ID: episodeID, Downloaded: true}, nil
}

func (s *Service) Delete(ctx context.Context, episodeID int64) (EpisodeDownload, error) {
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
			return meta.DownloadedPath.String, nil
		}
	}
	return "", nil
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
