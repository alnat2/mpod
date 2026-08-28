package audiobooks

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrBookNotFound  = errors.New("audiobook not found")
	ErrTrackNotFound = errors.New("audiobook track not found")
	ErrNoCover       = errors.New("audiobook cover not found")
)

type Service struct {
	db       *sql.DB
	rootDir  string
	watcher  *Watcher
	now      func() time.Time
	rescanMu sync.Mutex
}

func NewService(db *sql.DB, rootDir string) *Service {
	return &Service{
		db:      db,
		rootDir: filepath.Clean(rootDir),
		now:     time.Now,
	}
}

func (s *Service) StartWatcher(ctx context.Context) error {
	if s.rootDir == "" {
		return nil
	}

	w, err := NewWatcher(s.rootDir, 2500*time.Millisecond, func() {
		_ = s.Rescan(context.Background())
	})
	if err != nil {
		return fmt.Errorf("create audiobooks watcher: %w", err)
	}

	s.watcher = w
	return w.Start(ctx)
}

func (s *Service) Close() error {
	if s.watcher != nil {
		return s.watcher.Close()
	}
	return nil
}

func (s *Service) Rescan(ctx context.Context) error {
	s.rescanMu.Lock()
	defer s.rescanMu.Unlock()

	scanned, err := ScanDirectory(s.rootDir)
	if err != nil {
		return fmt.Errorf("scan audiobooks directory: %w", err)
	}

	return s.SyncWithScannedBooks(ctx, scanned)
}

func (s *Service) SyncWithScannedBooks(ctx context.Context, scanned []ScannedBook) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin audiobooks sync tx: %w", err)
	}
	defer tx.Rollback()

	seenRelPaths := make(map[string]struct{}, len(scanned))

	for _, sb := range scanned {
		seenRelPaths[sb.RelPath] = struct{}{}

		var bookID int64
		var currentCover sql.NullString
		err := tx.QueryRowContext(ctx, `
			SELECT id, cover_path FROM audiobooks WHERE rel_path = ?
		`, sb.RelPath).Scan(&bookID, &currentCover)

		now := s.now().UTC()

		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.ExecContext(ctx, `
				INSERT INTO audiobooks (title, author, rel_path, cover_path, total_duration, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`, sb.Title, sb.Author, sb.RelPath, sb.CoverPath, 0, now, now)
			if err != nil {
				return fmt.Errorf("insert audiobook %s: %w", sb.RelPath, err)
			}
			bookID, err = res.LastInsertId()
			if err != nil {
				return fmt.Errorf("get inserted audiobook id: %w", err)
			}
		} else if err == nil {
			if _, err := tx.ExecContext(ctx, `
				UPDATE audiobooks
				SET title = ?, author = ?, cover_path = ?, updated_at = ?
				WHERE id = ?
			`, sb.Title, sb.Author, sb.CoverPath, now, bookID); err != nil {
				return fmt.Errorf("update audiobook %s: %w", sb.RelPath, err)
			}
		} else {
			return fmt.Errorf("query audiobook %s: %w", sb.RelPath, err)
		}

		// Sync tracks
		seenTrackPaths := make(map[string]struct{}, len(sb.Tracks))
		for _, st := range sb.Tracks {
			seenTrackPaths[st.RelPath] = struct{}{}

			var trackID int64
			err := tx.QueryRowContext(ctx, `
				SELECT id FROM audiobook_tracks WHERE rel_path = ?
			`, st.RelPath).Scan(&trackID)

			if errors.Is(err, sql.ErrNoRows) {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO audiobook_tracks (audiobook_id, track_number, title, rel_path, file_path, duration, is_listened, created_at)
					VALUES (?, ?, ?, ?, ?, ?, 0, ?)
				`, bookID, st.TrackNumber, st.Title, st.RelPath, st.FilePath, st.Duration, now); err != nil {
					return fmt.Errorf("insert track %s: %w", st.RelPath, err)
				}
			} else if err == nil {
				if _, err := tx.ExecContext(ctx, `
					UPDATE audiobook_tracks
					SET track_number = ?, title = ?, file_path = ?, duration = ?
					WHERE id = ?
				`, st.TrackNumber, st.Title, st.FilePath, st.Duration, trackID); err != nil {
					return fmt.Errorf("update track %s: %w", st.RelPath, err)
				}
			} else {
				return fmt.Errorf("query track %s: %w", st.RelPath, err)
			}
		}

		// Delete tracks that no longer exist for this book
		rows, err := tx.QueryContext(ctx, `SELECT id, rel_path FROM audiobook_tracks WHERE audiobook_id = ?`, bookID)
		if err != nil {
			return fmt.Errorf("query existing tracks for book %d: %w", bookID, err)
		}
		var tracksToDelete []int64
		for rows.Next() {
			var tID int64
			var tRel string
			if err := rows.Scan(&tID, &tRel); err != nil {
				rows.Close()
				return err
			}
			if _, ok := seenTrackPaths[tRel]; !ok {
				tracksToDelete = append(tracksToDelete, tID)
			}
		}
		rows.Close()

		for _, tID := range tracksToDelete {
			if _, err := tx.ExecContext(ctx, `DELETE FROM audiobook_tracks WHERE id = ?`, tID); err != nil {
				return fmt.Errorf("delete missing track %d: %w", tID, err)
			}
		}
	}

	// Delete audiobooks from DB that are no longer in scanned directory
	bRows, err := tx.QueryContext(ctx, `SELECT id, rel_path FROM audiobooks`)
	if err != nil {
		return fmt.Errorf("query existing audiobooks: %w", err)
	}
	var booksToDelete []int64
	for bRows.Next() {
		var bID int64
		var bRel string
		if err := bRows.Scan(&bID, &bRel); err != nil {
			bRows.Close()
			return err
		}
		if _, ok := seenRelPaths[bRel]; !ok {
			booksToDelete = append(booksToDelete, bID)
		}
	}
	bRows.Close()

	for _, bID := range booksToDelete {
		if _, err := tx.ExecContext(ctx, `DELETE FROM audiobooks WHERE id = ?`, bID); err != nil {
			return fmt.Errorf("delete removed audiobook %d: %w", bID, err)
		}
	}

	return tx.Commit()
}

func (s *Service) List(ctx context.Context) ([]Audiobook, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.title, COALESCE(a.author, ''), a.rel_path, COALESCE(a.cover_path, ''),
		       a.total_duration, a.created_at, a.updated_at,
		       COUNT(t.id) as track_count,
		       SUM(CASE WHEN t.is_listened = 1 THEN 1 ELSE 0 END) as listened_count,
		       EXISTS(
		           SELECT 1 FROM playlist 
		           WHERE audiobook_id = a.id 
		              OR audiobook_track_id IN (SELECT id FROM audiobook_tracks WHERE audiobook_id = a.id)
		       ) as in_playlist
		FROM audiobooks a
		LEFT JOIN audiobook_tracks t ON t.audiobook_id = a.id
		GROUP BY a.id
		ORDER BY a.author ASC, a.title ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list audiobooks: %w", err)
	}
	defer rows.Close()

	var books []Audiobook
	for rows.Next() {
		var b Audiobook
		var author, coverPath string
		var trackCount, listenedCount sql.NullInt64
		var inPlaylist bool
		if err := rows.Scan(
			&b.ID, &b.Title, &author, &b.RelPath, &coverPath,
			&b.TotalDuration, &b.CreatedAt, &b.UpdatedAt,
			&trackCount, &listenedCount, &inPlaylist,
		); err != nil {
			return nil, fmt.Errorf("scan audiobook: %w", err)
		}
		b.Author = author
		b.CoverPath = coverPath
		b.HasCover = coverPath != ""
		b.TrackCount = int(trackCount.Int64)
		b.ListenedCount = int(listenedCount.Int64)
		b.IsListened = b.TrackCount > 0 && b.ListenedCount == b.TrackCount
		b.InPlaylist = inPlaylist

		books = append(books, b)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	if books == nil {
		books = []Audiobook{}
	}

	return books, nil
}

func (s *Service) Get(ctx context.Context, id int64) (*Audiobook, error) {
	var b Audiobook
	var author, coverPath string
	var inPlaylist bool
	err := s.db.QueryRowContext(ctx, `
		SELECT id, title, COALESCE(author, ''), rel_path, COALESCE(cover_path, ''),
		       total_duration, created_at, updated_at,
		       EXISTS(
		           SELECT 1 FROM playlist 
		           WHERE audiobook_id = audiobooks.id 
		              OR audiobook_track_id IN (SELECT id FROM audiobook_tracks WHERE audiobook_id = audiobooks.id)
		       ) as in_playlist
		FROM audiobooks
		WHERE id = ?
	`, id).Scan(
		&b.ID, &b.Title, &author, &b.RelPath, &coverPath,
		&b.TotalDuration, &b.CreatedAt, &b.UpdatedAt, &inPlaylist,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrBookNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get audiobook %d: %w", id, err)
	}
	b.Author = author
	b.CoverPath = coverPath
	b.HasCover = coverPath != ""
	b.InPlaylist = inPlaylist

	// Fetch tracks with playback progress
	tRows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.audiobook_id, t.track_number, t.title, t.rel_path, t.file_path,
		       t.duration, t.is_listened,
		       (
		           EXISTS(SELECT 1 FROM playlist WHERE audiobook_track_id = t.id)
		           OR
		           (
		               EXISTS(SELECT 1 FROM playlist WHERE audiobook_id = t.audiobook_id)
		               AND NOT EXISTS(SELECT 1 FROM audiobook_track_exclusions WHERE audiobook_id = t.audiobook_id AND track_id = t.id)
		           )
		       ) as in_playlist,
		       COALESCE(p.position_seconds, 0), p.last_updated
		FROM audiobook_tracks t
		LEFT JOIN audiobook_playback p ON p.track_id = t.id
		WHERE t.audiobook_id = ?
		ORDER BY t.track_number ASC, t.id ASC
	`, id)
	if err != nil {
		return nil, fmt.Errorf("query audiobook tracks: %w", err)
	}
	defer tRows.Close()

	var tracks []Track
	listenedCount := 0
	for tRows.Next() {
		var t Track
		var lastUpdated sql.NullTime
		if err := tRows.Scan(
			&t.ID, &t.AudiobookID, &t.TrackNumber, &t.Title, &t.RelPath, &t.FilePath,
			&t.Duration, &t.IsListened, &t.InPlaylist,
			&t.PositionSeconds, &lastUpdated,
		); err != nil {
			return nil, fmt.Errorf("scan audiobook track: %w", err)
		}
		if lastUpdated.Valid {
			t.LastUpdated = &lastUpdated.Time
		}
		if t.IsListened {
			listenedCount++
		}
		tracks = append(tracks, t)
	}
	if err := tRows.Err(); err != nil {
		return nil, err
	}

	b.Tracks = tracks
	b.TrackCount = len(tracks)
	b.ListenedCount = listenedCount
	b.IsListened = b.TrackCount > 0 && b.ListenedCount == b.TrackCount

	return &b, nil
}

func (s *Service) GetTrack(ctx context.Context, trackID int64) (*Track, error) {
	var t Track
	var lastUpdated sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT t.id, t.audiobook_id, t.track_number, t.title, t.rel_path, t.file_path,
		       t.duration, t.is_listened,
		       (
		           EXISTS(SELECT 1 FROM playlist WHERE audiobook_track_id = t.id)
		           OR
		           (
		               EXISTS(SELECT 1 FROM playlist WHERE audiobook_id = t.audiobook_id)
		               AND NOT EXISTS(SELECT 1 FROM audiobook_track_exclusions WHERE audiobook_id = t.audiobook_id AND track_id = t.id)
		           )
		       ) as in_playlist,
		       COALESCE(p.position_seconds, 0), p.last_updated
		FROM audiobook_tracks t
		LEFT JOIN audiobook_playback p ON p.track_id = t.id
		WHERE t.id = ?
	`, trackID).Scan(
		&t.ID, &t.AudiobookID, &t.TrackNumber, &t.Title, &t.RelPath, &t.FilePath,
		&t.Duration, &t.IsListened, &t.InPlaylist,
		&t.PositionSeconds, &lastUpdated,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTrackNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get track %d: %w", trackID, err)
	}
	if lastUpdated.Valid {
		t.LastUpdated = &lastUpdated.Time
	}
	return &t, nil
}

func (s *Service) AddTrackToPlaylist(ctx context.Context, trackID int64) error {
	var track Track
	var lastUpdated sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT t.id, t.audiobook_id, t.track_number, t.title, t.rel_path, t.file_path,
		       t.duration, t.is_listened,
		       (
		           EXISTS(SELECT 1 FROM playlist WHERE audiobook_track_id = t.id)
		           OR
		           (
		               EXISTS(SELECT 1 FROM playlist WHERE audiobook_id = t.audiobook_id)
		               AND NOT EXISTS(SELECT 1 FROM audiobook_track_exclusions WHERE audiobook_id = t.audiobook_id AND track_id = t.id)
		           )
		       ) as in_playlist,
		       COALESCE(p.position_seconds, 0), p.last_updated
		FROM audiobook_tracks t
		LEFT JOIN audiobook_playback p ON p.track_id = t.id
		WHERE t.id = ?
	`, trackID).Scan(
		&track.ID, &track.AudiobookID, &track.TrackNumber, &track.Title, &track.RelPath, &track.FilePath,
		&track.Duration, &track.IsListened, &track.InPlaylist,
		&track.PositionSeconds, &lastUpdated,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTrackNotFound
	}
	if err != nil {
		return fmt.Errorf("get track %d: %w", trackID, err)
	}

	if track.InPlaylist {
		return nil
	}

	// If parent audiobook is already in playlist, un-exclude the track
	var parentInPlaylist bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM playlist WHERE audiobook_id = ?)`, track.AudiobookID).Scan(&parentInPlaylist); err != nil {
		return fmt.Errorf("check parent audiobook in playlist: %w", err)
	}
	if parentInPlaylist {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM audiobook_track_exclusions WHERE audiobook_id = ? AND track_id = ?`, track.AudiobookID, trackID); err != nil {
			return fmt.Errorf("delete track exclusion: %w", err)
		}
		return nil
	}

	var maxPos sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `SELECT MAX(position) FROM playlist`).Scan(&maxPos); err != nil {
		return fmt.Errorf("get max playlist position: %w", err)
	}
	nextPos := int64(1)
	if maxPos.Valid {
		nextPos = maxPos.Int64 + 1
	}

	now := s.now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO playlist (audiobook_track_id, position, added_at)
		VALUES (?, ?, ?)
	`, trackID, nextPos, now); err != nil {
		return fmt.Errorf("insert track to playlist: %w", err)
	}

	return nil
}

func (s *Service) RemoveTrackFromPlaylist(ctx context.Context, trackID int64) error {
	var track Track
	err := s.db.QueryRowContext(ctx, `
		SELECT id, audiobook_id FROM audiobook_tracks WHERE id = ?
	`, trackID).Scan(&track.ID, &track.AudiobookID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTrackNotFound
	}
	if err != nil {
		return fmt.Errorf("get track %d: %w", trackID, err)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin remove track tx: %w", err)
	}
	defer tx.Rollback()

	// 1. If this specific track is directly in playlist, delete it
	if _, err := tx.ExecContext(ctx, `DELETE FROM playlist WHERE audiobook_track_id = ?`, trackID); err != nil {
		return fmt.Errorf("delete track from playlist: %w", err)
	}

	// 2. If the parent audiobook is in playlist, mark this track as excluded (keep the parent audiobook intact as 1 item)
	var parentInPlaylist bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM playlist WHERE audiobook_id = ?)`, track.AudiobookID).Scan(&parentInPlaylist); err != nil {
		return fmt.Errorf("check parent audiobook in playlist: %w", err)
	}
	if parentInPlaylist {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO audiobook_track_exclusions (audiobook_id, track_id)
			VALUES (?, ?)
		`, track.AudiobookID, trackID); err != nil {
			return fmt.Errorf("insert track exclusion: %w", err)
		}
	}

	now := s.now().UTC()
	_, _ = tx.ExecContext(ctx, `
		UPDATE active_playback
		SET audiobook_id = NULL, audiobook_track_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND audiobook_track_id = ?
	`, now, trackID)

	return tx.Commit()
}

func (s *Service) RemoveFromPlaylist(ctx context.Context, bookID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin remove audiobook tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM playlist
		WHERE audiobook_id = ? OR audiobook_track_id IN (SELECT id FROM audiobook_tracks WHERE audiobook_id = ?)
	`, bookID, bookID); err != nil {
		return fmt.Errorf("remove audiobook from playlist: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audiobook_track_exclusions WHERE audiobook_id = ?`, bookID); err != nil {
		return fmt.Errorf("clean track exclusions: %w", err)
	}
	now := s.now().UTC()
	_, _ = tx.ExecContext(ctx, `
		UPDATE active_playback
		SET audiobook_id = NULL, audiobook_track_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND (audiobook_id = ? OR audiobook_track_id IN (SELECT id FROM audiobook_tracks WHERE audiobook_id = ?))
	`, now, bookID, bookID)
	return tx.Commit()
}

func (s *Service) GetCoverData(ctx context.Context, bookID int64) ([]byte, string, string, error) {
	var coverPath sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT cover_path FROM audiobooks WHERE id = ?`, bookID).Scan(&coverPath)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", "", ErrBookNotFound
	}
	if err != nil {
		return nil, "", "", fmt.Errorf("query book cover: %w", err)
	}
	if !coverPath.Valid || coverPath.String == "" {
		return nil, "", "", ErrNoCover
	}

	if strings.HasPrefix(coverPath.String, "embedded:") {
		audioRel := strings.TrimPrefix(coverPath.String, "embedded:")
		absAudio := filepath.Join(s.rootDir, audioRel)
		data, mime, err := ExtractEmbeddedArtwork(absAudio)
		if err != nil {
			return nil, "", "", ErrNoCover
		}
		return data, mime, "", nil
	}

	absPath := filepath.Join(s.rootDir, coverPath.String)
	if _, err := os.Stat(absPath); err != nil {
		return nil, "", "", ErrNoCover
	}
	return nil, "", absPath, nil
}

func (s *Service) GetCoverPath(ctx context.Context, bookID int64) (string, error) {
	_, _, filePath, err := s.GetCoverData(ctx, bookID)
	return filePath, err
}

func (s *Service) Delete(ctx context.Context, bookID int64, deleteDiskFiles bool) error {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM audiobooks WHERE id = ?`, bookID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrBookNotFound
	}
	if err != nil {
		return fmt.Errorf("query book for delete: %w", err)
	}

	// Delete from DB (cascades to tracks, playback, playlist).
	// Audiobook directory is strictly read-only: disk files are never deleted.
	if _, err := s.db.ExecContext(ctx, `DELETE FROM audiobooks WHERE id = ?`, bookID); err != nil {
		return fmt.Errorf("delete audiobook db record: %w", err)
	}

	return nil
}

func (s *Service) SaveTrackProgress(ctx context.Context, trackID int64, positionSeconds int64, completed bool) (nextTrackID *int64, err error) {
	track, err := s.GetTrack(ctx, trackID)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin save progress tx: %w", err)
	}
	defer tx.Rollback()

	now := s.now().UTC()

	if completed {
		if _, err := tx.ExecContext(ctx, `
			UPDATE audiobook_tracks SET is_listened = 1 WHERE id = ?
		`, trackID); err != nil {
			return nil, fmt.Errorf("mark track listened: %w", err)
		}

		// Find next track in the same audiobook
		var nextID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id FROM audiobook_tracks
			WHERE audiobook_id = ? AND track_number > ?
			ORDER BY track_number ASC LIMIT 1
		`, track.AudiobookID, track.TrackNumber).Scan(&nextID)

		if err == nil {
			nextTrackID = &nextID
		} else if errors.Is(err, sql.ErrNoRows) {
			// This was the last track of the book!
			// Remove audiobook from playlist
			if _, err := tx.ExecContext(ctx, `DELETE FROM playlist WHERE audiobook_id = ?`, track.AudiobookID); err != nil {
				return nil, fmt.Errorf("remove completed audiobook from playlist: %w", err)
			}
			nextTrackID = nil
		} else {
			return nil, fmt.Errorf("query next track: %w", err)
		}
	} else {
		// Update position
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (track_id) DO UPDATE SET position_seconds = excluded.position_seconds, last_updated = excluded.last_updated
		`, trackID, track.AudiobookID, positionSeconds, now); err != nil {
			return nil, fmt.Errorf("update track playback: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit track progress: %w", err)
	}

	return nextTrackID, nil
}
