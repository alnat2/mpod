package http

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestIOSSafariMissingCookie(t *testing.T) {
	// Scenario 1: iOS AVFoundation drops the session cookie on a background Range request.
	handler, db := newTestRouter(t)
	seedEpisode(t, db, 1, 1)

	// Send request WITHOUT the session cookie
	req := httptest.NewRequest(http.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.Header.Set("Range", "bytes=100-200") // Simulate Range request
	
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// We expect this to fail with 401 Unauthorized (JSON error), which causes MEDIA_ERR_SRC_NOT_SUPPORTED in Safari
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 Unauthorized for missing cookie, got %d", rec.Code)
	}
	if cType := rec.Header().Get("Content-Type"); cType != "application/json" {
		t.Errorf("Expected application/json response, got %s", cType)
	}
}

func TestIOSSafariMissingExtension(t *testing.T) {
	// Scenario 2: Smart Listening downloads an episode from a URL without an extension.
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	
	// Create a dummy downloaded file WITHOUT an extension (e.g. "1-episode")
	downloadPath := filepath.Join(t.TempDir(), "1-episode")
	err := os.WriteFile(downloadPath, []byte("fake-audio-content-without-id3-tags"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (100, 'Test Podcast', 'http://example.com/feed'); INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (100, 100, 'ep-1', 'Episode', 'https://example.com/audio-without-ext', ?)`, downloadPath)

	req := httptest.NewRequest(http.MethodGet, "/api/episodes/100/audio", nil)
	req.SetPathValue("id", "100")
	req.AddCookie(cookie)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// We expect ServeFile to serve it as application/octet-stream, which Safari rejects
	if rec.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", rec.Code)
	}
	if cType := rec.Header().Get("Content-Type"); cType != "application/octet-stream" && cType != "text/plain; charset=utf-8" {
		t.Errorf("Expected application/octet-stream (or text) for extension-less file, got %s", cType)
	}
}
