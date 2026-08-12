package smartlistening

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
)

const (
	defaultPollInterval = time.Second
	defaultRetryDelay   = 5 * time.Minute
)

type downloader interface {
	Download(context.Context, int64) (downloads.EpisodeDownload, error)
	Delete(context.Context, int64) (downloads.EpisodeDownload, error)
}

type Service struct {
	db           *sql.DB
	logger       *log.Logger
	downloader   downloader
	now          func() time.Time
	pollInterval time.Duration
	retryDelay   time.Duration
}

func NewService(db *sql.DB, logger *log.Logger, downloader downloader) *Service {
	return &Service{
		db:           db,
		logger:       logger,
		downloader:   downloader,
		now:          time.Now,
		pollInterval: defaultPollInterval,
		retryDelay:   defaultRetryDelay,
	}
}

func (s *Service) Start(ctx context.Context) {
	go s.run(ctx)
}

func (s *Service) run(ctx context.Context) {
	s.processDue(ctx)
	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.processDue(ctx)
		}
	}
}

func (s *Service) processDue(ctx context.Context) {
	for ctx.Err() == nil {
		processed, err := s.RunOnce(ctx)
		if err != nil {
			s.logger.Printf("smart listening queue failed: %v", err)
			return
		}
		if !processed {
			return
		}
	}
}

func (s *Service) RunOnce(ctx context.Context) (bool, error) {
	now := s.now().UTC()
	var episodeID int64
	err := s.db.QueryRowContext(ctx, `
		SELECT playlist.episode_id
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		WHERE playlist.download_after IS NOT NULL
		  AND playlist.download_after <= ?
		  AND (episodes.downloaded_path IS NULL OR episodes.downloaded_path = '')
		ORDER BY playlist.download_after ASC, playlist.position ASC, playlist.id ASC
		LIMIT 1
	`, now).Scan(&episodeID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("load due playlist download: %w", err)
	}

	if _, err := s.downloader.Download(ctx, episodeID); err != nil {
		if ctx.Err() != nil {
			return true, ctx.Err()
		}
		nextAttempt := now.Add(s.retryDelay)
		if _, updateErr := s.db.ExecContext(ctx, `
			UPDATE playlist
			SET download_after = ?
			WHERE episode_id = ?
		`, nextAttempt, episodeID); updateErr != nil {
			return true, fmt.Errorf("reschedule playlist download %d: %w", episodeID, updateErr)
		}
		s.logger.Printf("smart listening download failed for episode %d; retry at %s: %v", episodeID, nextAttempt.Format(time.RFC3339), err)
		return true, nil
	}

	var stillInPlaylist int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE episode_id = ?`, episodeID).Scan(&stillInPlaylist); err != nil {
		return true, fmt.Errorf("verify downloaded playlist item %d: %w", episodeID, err)
	}
	if stillInPlaylist == 0 {
		if _, err := s.downloader.Delete(ctx, episodeID); err != nil && !errors.Is(err, downloads.ErrEpisodeNotFound) {
			return true, fmt.Errorf("discard removed playlist download %d: %w", episodeID, err)
		}
		return true, nil
	}

	s.logger.Printf("smart listening downloaded episode %d", episodeID)
	return true, nil
}
