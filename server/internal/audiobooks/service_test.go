package audiobooks

import (
	"context"
	"database/sql"
	"testing"

	"github.com/cross/mpod/server/internal/storage"
	_ "github.com/mattn/go-sqlite3"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}

	if err := storage.Migrate(db, "../../migrations"); err != nil {
		t.Fatalf("migrate db: %v", err)
	}

	return db
}

func TestServiceSyncAndRead(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tempDir := t.TempDir()
	svc := NewService(db, tempDir)

	scanned := []ScannedBook{
		{
			Title:     "Ананасная вода",
			Author:    "Пелевин",
			RelPath:   "Пелевин/Ананасная вода",
			CoverPath: "Пелевин/Ананасная вода/cover.jpg",
			Tracks: []ScannedTrack{
				{TrackNumber: 1, Title: "01", RelPath: "Пелевин/Ананасная вода/01.mp3", FilePath: "/abs/01.mp3", Duration: 120},
				{TrackNumber: 2, Title: "02", RelPath: "Пелевин/Ананасная вода/02.mp3", FilePath: "/abs/02.mp3", Duration: 180},
			},
		},
		{
			Title:   "1984",
			Author:  "",
			RelPath: "1984.m4b",
			Tracks: []ScannedTrack{
				{TrackNumber: 1, Title: "1984", RelPath: "1984.m4b", FilePath: "/abs/1984.m4b"},
			},
		},
	}

	ctx := context.Background()
	if err := svc.SyncWithScannedBooks(ctx, scanned); err != nil {
		t.Fatalf("SyncWithScannedBooks failed: %v", err)
	}

	books, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(books) != 2 {
		t.Fatalf("expected 2 books, got %d", len(books))
	}

	// Fetch detail of first book
	b1, err := svc.Get(ctx, books[1].ID) // "Ананасная вода"
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if b1.Title != "Ананасная вода" || len(b1.Tracks) != 2 {
		t.Fatalf("unexpected book details: %+v", b1)
	}
	if b1.TotalDuration != 300 || b1.Tracks[0].Duration != 120 || b1.Tracks[1].Duration != 180 {
		t.Fatalf("expected scanned durations to be stored, got %+v", b1)
	}
}

func TestTrackPlaylistAdditionAndRemoval(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	svc := NewService(db, t.TempDir())
	ctx := context.Background()

	scanned := []ScannedBook{
		{
			Title:   "Dune",
			Author:  "Frank Herbert",
			RelPath: "Frank Herbert/Dune",
			Tracks: []ScannedTrack{
				{TrackNumber: 1, Title: "Chapter 1", RelPath: "Frank Herbert/Dune/01.mp3", FilePath: "/abs/01.mp3", Duration: 1000},
				{TrackNumber: 2, Title: "Chapter 2", RelPath: "Frank Herbert/Dune/02.mp3", FilePath: "/abs/02.mp3", Duration: 1200},
			},
		},
	}
	if err := svc.SyncWithScannedBooks(ctx, scanned); err != nil {
		t.Fatalf("SyncWithScannedBooks failed: %v", err)
	}

	books, err := svc.List(ctx)
	if err != nil || len(books) == 0 {
		t.Fatalf("List failed: %v", err)
	}
	book, err := svc.Get(ctx, books[0].ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	track1 := book.Tracks[0]
	if track1.InPlaylist {
		t.Fatalf("expected track1 not in playlist initially")
	}

	// Add track 1 to playlist
	if err := svc.AddTrackToPlaylist(ctx, track1.ID); err != nil {
		t.Fatalf("AddTrackToPlaylist failed: %v", err)
	}

	// Verify track is in playlist
	bookUpdated, err := svc.Get(ctx, book.ID)
	if err != nil {
		t.Fatalf("Get updated failed: %v", err)
	}
	if !bookUpdated.Tracks[0].InPlaylist {
		t.Errorf("expected track 1 in playlist after AddTrackToPlaylist")
	}
	if bookUpdated.Tracks[1].InPlaylist {
		t.Errorf("expected track 2 NOT in playlist")
	}

	// Remove track 1 from playlist
	if err := svc.RemoveTrackFromPlaylist(ctx, track1.ID); err != nil {
		t.Fatalf("RemoveTrackFromPlaylist failed: %v", err)
	}

	bookAfterRemove, err := svc.Get(ctx, book.ID)
	if err != nil {
		t.Fatalf("Get after remove failed: %v", err)
	}
	if bookAfterRemove.Tracks[0].InPlaylist {
		t.Errorf("expected track 1 not in playlist after RemoveTrackFromPlaylist")
	}
}

func TestBookInPlaylistReflectsOnTracks(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	svc := NewService(db, t.TempDir())
	ctx := context.Background()

	scanned := []ScannedBook{
		{
			Title:   "Dune",
			Author:  "Frank Herbert",
			RelPath: "Frank Herbert/Dune",
			Tracks: []ScannedTrack{
				{TrackNumber: 1, Title: "Chapter 1", RelPath: "Frank Herbert/Dune/01.mp3", FilePath: "/abs/01.mp3", Duration: 1000},
				{TrackNumber: 2, Title: "Chapter 2", RelPath: "Frank Herbert/Dune/02.mp3", FilePath: "/abs/02.mp3", Duration: 1200},
			},
		},
	}
	if err := svc.SyncWithScannedBooks(ctx, scanned); err != nil {
		t.Fatalf("SyncWithScannedBooks failed: %v", err)
	}

	books, err := svc.List(ctx)
	if err != nil || len(books) == 0 {
		t.Fatalf("List failed: %v", err)
	}
	bookID := books[0].ID

	// Add whole book to playlist
	if _, err := db.ExecContext(ctx, `INSERT INTO playlist (audiobook_id, position) VALUES (?, 1)`, bookID); err != nil {
		t.Fatalf("add book to playlist: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) SELECT audiobook_id, id FROM audiobook_tracks WHERE audiobook_id = ?`, bookID); err != nil {
		t.Fatalf("select book tracks: %v", err)
	}

	// Verify both tracks report InPlaylist = true
	b, err := svc.Get(ctx, bookID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if !b.InPlaylist {
		t.Errorf("expected book in playlist")
	}
	if !b.Tracks[0].InPlaylist {
		t.Errorf("expected track 1 in playlist when whole book is in playlist")
	}
	if !b.Tracks[1].InPlaylist {
		t.Errorf("expected track 2 in playlist when whole book is in playlist")
	}

	// A later scan discovers another file, but an existing playlist selection is
	// stable until the user explicitly adds that chapter.
	scanned[0].Tracks = append(scanned[0].Tracks, ScannedTrack{
		TrackNumber: 3,
		Title:       "Chapter 3",
		RelPath:     "Frank Herbert/Dune/03.mp3",
		FilePath:    "/abs/03.mp3",
		Duration:    900,
	})
	if err := svc.SyncWithScannedBooks(ctx, scanned); err != nil {
		t.Fatalf("rescan with a new chapter failed: %v", err)
	}
	b, err = svc.Get(ctx, bookID)
	if err != nil {
		t.Fatalf("Get after rescan failed: %v", err)
	}
	if len(b.Tracks) != 3 || b.Tracks[2].InPlaylist {
		t.Fatalf("expected newly scanned chapter to stay out of existing selection: %+v", b.Tracks)
	}

	// Remove track 1 -> book entry remains in playlist as 1 item.
	if err := svc.RemoveTrackFromPlaylist(ctx, b.Tracks[0].ID); err != nil {
		t.Fatalf("RemoveTrackFromPlaylist failed: %v", err)
	}

	var bookPlaylistCount int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, bookID).Scan(&bookPlaylistCount)
	if bookPlaylistCount != 1 {
		t.Errorf("expected audiobook to remain 1 item in playlist, got count %d", bookPlaylistCount)
	}
	bAfter, err := svc.Get(ctx, bookID)
	if err != nil {
		t.Fatalf("Get after track removal failed: %v", err)
	}
	if bAfter.Tracks[0].InPlaylist {
		t.Errorf("expected track 1 NOT in playlist after removal")
	}
	if !bAfter.Tracks[1].InPlaylist {
		t.Errorf("expected track 2 still in playlist after removing track 1 from book playlist")
	}

	// Re-add track 1 -> it returns to the same parent item.
	if err := svc.AddTrackToPlaylist(ctx, b.Tracks[0].ID); err != nil {
		t.Fatalf("AddTrackToPlaylist failed: %v", err)
	}
	bReAdded, err := svc.Get(ctx, bookID)
	if err != nil {
		t.Fatalf("Get after re-add failed: %v", err)
	}
	if !bReAdded.Tracks[0].InPlaylist {
		t.Errorf("expected track 1 in playlist after re-adding")
	}

	if _, err := db.ExecContext(ctx, `
		UPDATE audiobook_tracks SET is_listened = 1 WHERE audiobook_id = ?;
		INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds)
		VALUES (?, ?, 42);
	`, bookID, b.Tracks[1].ID, bookID); err != nil {
		t.Fatalf("seed audiobook state before final removal: %v", err)
	}
	if err := svc.RemoveTrackFromPlaylist(ctx, b.Tracks[0].ID); err != nil {
		t.Fatalf("remove first selected track: %v", err)
	}
	if err := svc.RemoveTrackFromPlaylist(ctx, b.Tracks[1].ID); err != nil {
		t.Fatalf("remove final selected track: %v", err)
	}

	var remainingPlaylist, remainingPlayback, listenedTracks int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, bookID).Scan(&remainingPlaylist)
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM audiobook_playback WHERE audiobook_id = ?`, bookID).Scan(&remainingPlayback)
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM audiobook_tracks WHERE audiobook_id = ? AND is_listened = 1`, bookID).Scan(&listenedTracks)
	if remainingPlaylist != 0 || remainingPlayback != 0 || listenedTracks != 0 {
		t.Fatalf("expected final chapter removal to reset book state, got playlist=%d playback=%d listened=%d", remainingPlaylist, remainingPlayback, listenedTracks)
	}
}
