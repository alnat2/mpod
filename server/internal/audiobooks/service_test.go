package audiobooks

import (
	"context"
	"database/sql"
	"errors"
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

func TestServiceSyncAndCRUD(t *testing.T) {
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
				{TrackNumber: 1, Title: "01", RelPath: "Пелевин/Ананасная вода/01.mp3", FilePath: "/abs/01.mp3"},
				{TrackNumber: 2, Title: "02", RelPath: "Пелевин/Ананасная вода/02.mp3", FilePath: "/abs/02.mp3"},
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

	// Test progress update
	track1 := b1.Tracks[0]
	nextTrack, err := svc.SaveTrackProgress(ctx, track1.ID, 120, false)
	if err != nil {
		t.Fatalf("SaveTrackProgress position failed: %v", err)
	}
	if nextTrack != nil {
		t.Errorf("expected nextTrack nil on non-complete update")
	}

	// Verify track position saved
	t1Updated, err := svc.GetTrack(ctx, track1.ID)
	if err != nil {
		t.Fatalf("GetTrack failed: %v", err)
	}
	if t1Updated.PositionSeconds != 120 {
		t.Errorf("expected position 120, got %d", t1Updated.PositionSeconds)
	}

	// Add audiobook to playlist
	if _, err := db.ExecContext(ctx, `INSERT INTO playlist (audiobook_id, position) VALUES (?, 1)`, b1.ID); err != nil {
		t.Fatalf("add to playlist: %v", err)
	}

	// Complete track 1 -> should return track 2
	nextTrack, err = svc.SaveTrackProgress(ctx, track1.ID, 300, true)
	if err != nil {
		t.Fatalf("SaveTrackProgress complete failed: %v", err)
	}
	if nextTrack == nil || *nextTrack != b1.Tracks[1].ID {
		t.Fatalf("expected nextTrack %d, got %v", b1.Tracks[1].ID, nextTrack)
	}

	// Complete track 2 (final track of the book) -> should return nil and remove from playlist
	nextTrack, err = svc.SaveTrackProgress(ctx, b1.Tracks[1].ID, 300, true)
	if err != nil {
		t.Fatalf("SaveTrackProgress complete final track failed: %v", err)
	}
	if nextTrack != nil {
		t.Fatalf("expected nextTrack nil for final track, got %v", nextTrack)
	}

	// Verify playlist removal
	var count int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, b1.ID).Scan(&count)
	if count != 0 {
		t.Errorf("expected audiobook removed from playlist on full completion, got count %d", count)
	}

	// Test Delete book
	if err := svc.Delete(ctx, b1.ID, false); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	_, err = svc.Get(ctx, b1.ID)
	if !errors.Is(err, ErrBookNotFound) {
		t.Fatalf("expected ErrBookNotFound after delete, got %v", err)
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

	// Remove track 1 -> book entry is removed and track 2 remains in playlist
	if err := svc.RemoveTrackFromPlaylist(ctx, b.Tracks[0].ID); err != nil {
		t.Fatalf("RemoveTrackFromPlaylist failed: %v", err)
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
}
