package audiobooks

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playback"
	"github.com/cross/mpod/server/internal/playlist"
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

func fileSHA256(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file for hashing: %v", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestExtendedLibraryAndMixedQueueRegression(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	audiobooksDir := t.TempDir()
	svc := NewService(db, audiobooksDir)
	ctx := context.Background()

	epActions := episodes.NewActions(db, downloads.NewService(db, nil, t.TempDir()))
	plService := playlist.NewService(db)
	pbService := playback.NewService(db, epActions, plService)

	// 1. Setup initial books on filesystem
	book1Dir := filepath.Join(audiobooksDir, "Author One", "Book One")
	mustMkdir(t, book1Dir)
	mustCopyFixture(t, "valid.mp3", filepath.Join(book1Dir, "01.mp3"))
	mustCopyFixture(t, "valid.mp3", filepath.Join(book1Dir, "02.mp3"))

	book2File := filepath.Join(audiobooksDir, "Book Two.m4b")
	mustCopyFixture(t, "valid.m4b", book2File)

	// Record initial SHA256 of files on disk
	initialHash1 := fileSHA256(t, filepath.Join(book1Dir, "01.mp3"))
	initialHash2 := fileSHA256(t, filepath.Join(book1Dir, "02.mp3"))

	// 2. Initial rescan -> both books found
	if err := svc.Rescan(ctx); err != nil {
		t.Fatalf("initial rescan failed: %v", err)
	}

	books, err := svc.List(ctx)
	if err != nil || len(books) != 2 {
		t.Fatalf("expected 2 books after initial rescan, got %d (err: %v)", len(books), err)
	}

	var book1, book2 *Audiobook
	for i := range books {
		if books[i].Title == "Book One" {
			book1 = &books[i]
		} else if books[i].Title == "Book Two" {
			book2 = &books[i]
		}
	}
	if book1 == nil || book2 == nil {
		t.Fatalf("expected both Book One and Book Two in library")
	}

	// 3. Create podcast and episode in DB
	if _, err := db.ExecContext(ctx, `
		INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Tech Weekly', 'https://example.com/feed.xml');
		INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration)
		VALUES (101, 1, 'ep-101', 'Episode 101', 'https://example.com/101.mp3', 3600);
	`); err != nil {
		t.Fatalf("insert podcast and episode: %v", err)
	}

	// 4. Form a mixed queue:
	// Add podcast episode first
	if err := plService.Add(ctx, 101); err != nil {
		t.Fatalf("add podcast episode to playlist: %v", err)
	}

	// Add selected chapters of Book One
	b1Detail, err := svc.Get(ctx, book1.ID)
	if err != nil || len(b1Detail.Tracks) != 2 {
		t.Fatalf("expected 2 tracks in Book One, got %+v", b1Detail)
	}
	if err := svc.AddTrackToPlaylist(ctx, b1Detail.Tracks[0].ID); err != nil {
		t.Fatalf("add track 0 to playlist failed: %v", err)
	}
	if err := svc.AddTrackToPlaylist(ctx, b1Detail.Tracks[1].ID); err != nil {
		t.Fatalf("add track 1 to playlist failed: %v", err)
	}

	// Verify mixed queue representation: 2 items (1 podcast, 1 audiobook)
	queue, err := pbService.ListQueue(ctx)
	if err != nil {
		t.Fatalf("list queue failed: %v", err)
	}
	if len(queue) != 2 {
		t.Fatalf("expected 2 items in mixed queue, got %d", len(queue))
	}
	if queue[0].Type != "episode" || queue[0].ID != 101 {
		t.Fatalf("expected first queue item to be podcast episode 101, got %+v", queue[0])
	}
	if queue[1].Type != "audiobook" || queue[1].AudiobookID == nil || *queue[1].AudiobookID != book1.ID {
		t.Fatalf("expected second queue item to be audiobook %d, got %+v", book1.ID, queue[1])
	}

	// 5. Media type transitions and independent progress tracking:
	// Start podcast playback at position 50s
	epID := int64(101)
	activeEp, err := pbService.SetActiveItem(ctx, &epID, nil, nil)
	if err != nil || activeEp == nil {
		t.Fatalf("set active podcast episode: %v", err)
	}
	now := time.Now().UTC()
	if _, err := pbService.Update(ctx, playback.UpdateInput{
		EpisodeID:       101,
		PositionSeconds: 50,
		ClientUpdatedAt: &now,
	}); err != nil {
		t.Fatalf("update podcast playback: %v", err)
	}

	// Transition to audiobook playback at position 180s
	abID := book1.ID
	trID := b1Detail.Tracks[0].ID
	activeAb, err := pbService.SetActiveItem(ctx, nil, &abID, &trID)
	if err != nil || activeAb == nil {
		t.Fatalf("set active audiobook track: %v", err)
	}
	now = time.Now().UTC()
	if _, err := pbService.Update(ctx, playback.UpdateInput{
		AudiobookID:     &abID,
		TrackID:         &trID,
		PositionSeconds: 180,
		ClientUpdatedAt: &now,
	}); err != nil {
		t.Fatalf("update audiobook playback: %v", err)
	}

	// Transition back to podcast -> retains position 50s
	activeEpAgain, err := pbService.SetActiveItem(ctx, &epID, nil, nil)
	if err != nil || activeEpAgain == nil {
		t.Fatalf("switch back to podcast episode: %v", err)
	}
	epPlayback, err := pbService.GetEpisode(ctx, 101)
	if err != nil || epPlayback == nil || epPlayback.PositionSeconds != 50 {
		t.Fatalf("expected podcast position 50s, got %+v (err: %v)", epPlayback, err)
	}

	// Transition back to audiobook -> retains position 180s
	activeAbAgain, err := pbService.SetActiveItem(ctx, nil, &abID, &trID)
	if err != nil || activeAbAgain == nil {
		t.Fatalf("switch back to audiobook track: %v", err)
	}
	abPlayback, err := pbService.GetAudiobook(ctx, abID, &trID)
	if err != nil || abPlayback == nil || abPlayback.PositionSeconds != 180 {
		t.Fatalf("expected audiobook position 180s, got %+v (err: %v)", abPlayback, err)
	}

	// 6. Reload / multi-device simulation:
	// Fresh playback service instance connects to the same DB
	pbServiceDevice2 := playback.NewService(db, epActions, plService)
	activeItemDevice2, err := pbServiceDevice2.GetActive(ctx)
	if err != nil || activeItemDevice2 == nil {
		t.Fatalf("second device failed to get active item: %v", err)
	}
	if activeItemDevice2.AudiobookID == nil || *activeItemDevice2.AudiobookID != book1.ID || activeItemDevice2.AudiobookTrackID == nil || *activeItemDevice2.AudiobookTrackID != trID {
		t.Fatalf("second device desynchronized: got %+v", activeItemDevice2)
	}
	reloadedQueue, err := pbServiceDevice2.ListQueue(ctx)
	if err != nil || len(reloadedQueue) != 2 {
		t.Fatalf("second device got invalid queue length: %v", err)
	}

	// 7. Rescan disappearance: remove Book Two from disk
	if err := os.Remove(book2File); err != nil {
		t.Fatalf("remove book2 file failed: %v", err)
	}
	if err := svc.Rescan(ctx); err != nil {
		t.Fatalf("rescan after removal failed: %v", err)
	}
	booksAfterRemove, err := svc.List(ctx)
	if err != nil || len(booksAfterRemove) != 1 {
		t.Fatalf("expected 1 book after Book Two removal, got %d", len(booksAfterRemove))
	}
	if booksAfterRemove[0].Title != "Book One" {
		t.Fatalf("expected Book One to remain, got %q", booksAfterRemove[0].Title)
	}

	// Book One selected chapters are preserved across rescan
	b1Check, err := svc.Get(ctx, book1.ID)
	if err != nil || !b1Check.InPlaylist || !b1Check.Tracks[0].InPlaylist || !b1Check.Tracks[1].InPlaylist {
		t.Fatalf("expected Book One playlist tracks to be preserved across rescan")
	}

	// 8. Rescan appearance: add Book Three to disk
	book3File := filepath.Join(audiobooksDir, "Book Three.mp3")
	mustCopyFixture(t, "valid.mp3", book3File)
	if err := svc.Rescan(ctx); err != nil {
		t.Fatalf("rescan after adding book3 failed: %v", err)
	}
	booksAfterAdd, err := svc.List(ctx)
	if err != nil || len(booksAfterAdd) != 2 {
		t.Fatalf("expected 2 books after Book Three added, got %d", len(booksAfterAdd))
	}

	// 9. Remove selected book from playlist and verify queue reconciliation
	if err := plService.RemoveAudiobook(ctx, book1.ID); err != nil {
		t.Fatalf("remove book from playlist failed: %v", err)
	}
	queueAfterRemoval, err := pbService.ListQueue(ctx)
	if err != nil {
		t.Fatalf("list queue after removal failed: %v", err)
	}
	if len(queueAfterRemoval) != 1 || queueAfterRemoval[0].Type != "episode" {
		t.Fatalf("expected only podcast episode remaining in queue, got %+v", queueAfterRemoval)
	}

	// 10. Source file immutability:
	// Verify source files on disk were never modified or deleted
	if _, err := os.Stat(filepath.Join(book1Dir, "01.mp3")); err != nil {
		t.Fatalf("source file 01.mp3 missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(book1Dir, "02.mp3")); err != nil {
		t.Fatalf("source file 02.mp3 missing: %v", err)
	}
	if hash := fileSHA256(t, filepath.Join(book1Dir, "01.mp3")); hash != initialHash1 {
		t.Fatalf("source file Book One/01.mp3 was modified!")
	}
	if hash := fileSHA256(t, filepath.Join(book1Dir, "02.mp3")); hash != initialHash2 {
		t.Fatalf("source file Book One/02.mp3 was modified!")
	}
}
