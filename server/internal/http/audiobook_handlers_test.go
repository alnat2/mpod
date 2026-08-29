package http

import (
	"bytes"
	"encoding/json"
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/audiobooks"
	"github.com/cross/mpod/server/internal/config"
)

func TestAudiobookAPI(t *testing.T) {
	// Set up temporary audiobooks directory
	audiobooksDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		AudiobooksDir: audiobooksDir,
		DownloadsDir:  t.TempDir(),
	})
	cookie := register(t, handler, "admin", "secret")
	bookDir := filepath.Join(audiobooksDir, "Пелевин", "Ананасная вода")
	if err := os.MkdirAll(bookDir, 0o755); err != nil {
		t.Fatal(err)
	}

	track1Path := filepath.Join(bookDir, "01_Глава 1.mp3")
	track2Path := filepath.Join(bookDir, "02_Глава 2.mp3")
	coverPath := filepath.Join(bookDir, "cover.jpg")

	if err := os.WriteFile(track1Path, []byte("fake-mp3-audio-data-track-1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(track2Path, []byte("fake-mp3-audio-data-track-2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(coverPath, []byte("fake-cover-image-data"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Insert into DB (or rescan)
	audioSvc := audiobooks.NewService(db.SQL, audiobooksDir)
	if err := audioSvc.Rescan(t.Context()); err != nil {
		t.Fatalf("Rescan failed: %v", err)
	}

	// 1. GET /api/audiobooks
	req := httptest.NewRequest(nethttp.MethodGet, "/api/audiobooks", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("GET /api/audiobooks returned %d: %s", rec.Code, rec.Body.String())
	}

	var listResp struct {
		Audiobooks []audiobooks.Audiobook `json:"audiobooks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list response: %v", err)
	}
	if len(listResp.Audiobooks) != 1 {
		t.Fatalf("expected 1 audiobook, got %d", len(listResp.Audiobooks))
	}
	book := listResp.Audiobooks[0]
	if book.Title != "Ананасная вода" || book.Author != "Пелевин" || book.TrackCount != 2 {
		t.Fatalf("unexpected audiobook summary: %+v", book)
	}

	// 2. GET /api/audiobooks/:id
	req = httptest.NewRequest(nethttp.MethodGet, "/api/audiobooks/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("GET /api/audiobooks/1 returned %d: %s", rec.Code, rec.Body.String())
	}

	var detailResp struct {
		Audiobook audiobooks.Audiobook `json:"audiobook"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detailResp); err != nil {
		t.Fatalf("unmarshal detail response: %v", err)
	}
	if len(detailResp.Audiobook.Tracks) != 2 {
		t.Fatalf("expected 2 tracks, got %d", len(detailResp.Audiobook.Tracks))
	}
	track1 := detailResp.Audiobook.Tracks[0]

	// 3. GET /api/audiobooks/:id/tracks/:trackId/audio
	req = httptest.NewRequest(nethttp.MethodGet, "/api/audiobooks/1/tracks/1/audio", nil)
	req.SetPathValue("id", "1")
	req.SetPathValue("trackId", "1")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("GET audio returned %d: %s", rec.Code, rec.Body.String())
	}
	if ctype := rec.Header().Get("Content-Type"); ctype != "audio/mpeg" {
		t.Errorf("expected audio/mpeg Content-Type, got %s", ctype)
	}
	if rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("expected Accept-Ranges: bytes")
	}

	// 4. GET /api/audiobooks/:id/cover
	req = httptest.NewRequest(nethttp.MethodGet, "/api/audiobooks/1/cover", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("GET cover returned %d: %s", rec.Code, rec.Body.String())
	}
	if ctype := rec.Header().Get("Content-Type"); ctype != "image/jpeg" {
		t.Errorf("expected image/jpeg Content-Type, got %s", ctype)
	}

	// 5. POST /api/playlist (add audiobook to playlist)
	addPayload, _ := json.Marshal(map[string]any{"audiobookId": 1})
	req = httptest.NewRequest(nethttp.MethodPost, "/api/playlist", bytes.NewReader(addPayload))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("POST /api/playlist returned %d: %s", rec.Code, rec.Body.String())
	}

	// GET /api/playlist - verify audiobook is present
	req = httptest.NewRequest(nethttp.MethodGet, "/api/playlist", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("GET /api/playlist returned %d: %s", rec.Code, rec.Body.String())
	}

	// 6. POST /api/playback (update position through the unified playback API)
	pbPayload, _ := json.Marshal(map[string]any{
		"audiobookId":     book.ID,
		"trackId":         track1.ID,
		"positionSeconds": 45,
		"durationSeconds": 100,
		"completed":       false,
	})
	req = httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader(pbPayload))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("POST playback returned %d: %s", rec.Code, rec.Body.String())
	}

	// 7. POST /api/playback (complete track 1 -> returns nextTrackId: 2)
	pbCompletePayload, _ := json.Marshal(map[string]any{
		"audiobookId":     book.ID,
		"trackId":         track1.ID,
		"positionSeconds": 100,
		"durationSeconds": 100,
		"completed":       true,
	})
	req = httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader(pbCompletePayload))
	req.AddCookie(cookie)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("POST playback complete returned %d: %s", rec.Code, rec.Body.String())
	}
	var pbResp struct {
		NextTrackID *int64 `json:"nextTrackId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pbResp); err != nil {
		t.Fatalf("unmarshal playback complete response: %v", err)
	}
	if pbResp.NextTrackID == nil || *pbResp.NextTrackID != 2 {
		t.Fatalf("expected nextTrackId 2, got %v", pbResp.NextTrackID)
	}

	// 8. DELETE /api/audiobooks/:id/playlist (remove audiobook from playlist)
	req = httptest.NewRequest(nethttp.MethodDelete, "/api/audiobooks/1/playlist", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("DELETE playlist returned %d: %s", rec.Code, rec.Body.String())
	}

}
