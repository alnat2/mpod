package http

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"mime/multipart"
	nethttp "net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/config"
	"github.com/cross/mpod/server/internal/scheduler"
	"github.com/cross/mpod/server/internal/settings"
	"github.com/cross/mpod/server/internal/storage"
)

func TestProtectedRouteRequiresAuth(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "UNAUTHORIZED")
}

func TestRegisterCreatesSessionAndSessionEndpointReflectsAuth(t *testing.T) {
	handler, _ := newTestRouter(t)

	body := []byte(`{"username":"admin","password":"secret","confirmPassword":"secret"}`)
	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != "mpod_session" || cookies[0].Value == "" {
		t.Fatalf("expected session cookie, got %+v", cookies)
	}

	sessionReq := httptest.NewRequest(nethttp.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(cookies[0])
	sessionRec := httptest.NewRecorder()
	handler.ServeHTTP(sessionRec, sessionReq)

	if sessionRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from session endpoint, got %d body=%s", sessionRec.Code, sessionRec.Body.String())
	}

	var payload struct {
		Authenticated bool `json:"authenticated"`
		SetupRequired bool `json:"setupRequired"`
		User          struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.Unmarshal(sessionRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("Unmarshal session payload failed: %v", err)
	}
	if !payload.Authenticated || payload.SetupRequired || payload.User.Username != "admin" {
		t.Fatalf("unexpected session payload: %+v", payload)
	}
}

func TestPodcastGetRejectsInvalidPathParameter(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/not-a-number", nil)
	req.SetPathValue("id", "not-a-number")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_PATH_PARAM")
}

func TestSettingsPatchRejectsInvalidTime(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"dailyRefreshTime":"99:00"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_SETTINGS")
}

func TestLoginInvalidCredentials(t *testing.T) {
	handler, _ := newTestRouter(t)
	register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/login", bytes.NewReader([]byte(`{"username":"admin","password":"wrong"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_CREDENTIALS")
}

func TestLogoutClearsCookie(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != "mpod_session" || cookies[0].MaxAge != -1 {
		t.Fatalf("expected cleared session cookie, got %+v", cookies)
	}
}

func TestHealthEndpoint(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var payload map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if !payload["ok"] {
		t.Fatalf("expected ok=true, got %v", payload)
	}
}

func TestPodcastsListReturnsItems(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Podcasts []struct {
			ID    int64  `json:"id"`
			Title string `json:"title"`
		} `json:"podcasts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if len(payload.Podcasts) != 1 || payload.Podcasts[0].Title != "Podcast One" {
		t.Fatalf("unexpected podcasts payload: %+v", payload)
	}
}

func TestPodcastGetNotFound(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/999", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PODCAST_NOT_FOUND")
}

func TestPlaylistEndpoints(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	addReq := httptest.NewRequest(nethttp.MethodPost, "/api/playlist", bytes.NewReader([]byte(`{"episodeId":1}`)))
	addReq.AddCookie(cookie)
	addRec := httptest.NewRecorder()
	handler.ServeHTTP(addRec, addReq)
	if addRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playlist add, got %d body=%s", addRec.Code, addRec.Body.String())
	}

	listReq := httptest.NewRequest(nethttp.MethodGet, "/api/playlist", nil)
	listReq.AddCookie(cookie)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playlist list, got %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		Items []struct {
			EpisodeID int64 `json:"episodeId"`
		} `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("Unmarshal playlist list failed: %v", err)
	}
	if len(listPayload.Items) != 1 || listPayload.Items[0].EpisodeID != 1 {
		t.Fatalf("unexpected playlist payload: %+v", listPayload)
	}

	reorderReq := httptest.NewRequest(nethttp.MethodPatch, "/api/playlist/reorder", bytes.NewReader([]byte(`{"episodeIds":[1]}`)))
	reorderReq.AddCookie(cookie)
	reorderRec := httptest.NewRecorder()
	handler.ServeHTTP(reorderRec, reorderReq)
	if reorderRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from reorder, got %d body=%s", reorderRec.Code, reorderRec.Body.String())
	}

	removeReq := httptest.NewRequest(nethttp.MethodDelete, "/api/playlist/1", nil)
	removeReq.SetPathValue("episodeId", "1")
	removeReq.AddCookie(cookie)
	removeRec := httptest.NewRecorder()
	handler.ServeHTTP(removeRec, removeReq)
	if removeRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from remove, got %d body=%s", removeRec.Code, removeRec.Body.String())
	}
}

func TestPlaylistReorderRejectsInvalidOrder(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)
	seedEpisode(t, db, 2, 1)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1), (2, 2)`)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/playlist/reorder", bytes.NewReader([]byte(`{"episodeIds":[1]}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_PLAYLIST_ORDER")
}

func TestPlaybackEndpoints(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	getReq := httptest.NewRequest(nethttp.MethodGet, "/api/playback/1", nil)
	getReq.SetPathValue("episodeId", "1")
	getReq.AddCookie(cookie)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playback get, got %d body=%s", getRec.Code, getRec.Body.String())
	}
	if !strings.Contains(getRec.Body.String(), `"playback":null`) {
		t.Fatalf("expected null playback, got %s", getRec.Body.String())
	}

	postReq := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":1,"positionSeconds":120,"durationSeconds":300,"completed":false,"didSeek":false}`)))
	postReq.AddCookie(cookie)
	postRec := httptest.NewRecorder()
	handler.ServeHTTP(postRec, postReq)
	if postRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playback post, got %d body=%s", postRec.Code, postRec.Body.String())
	}
}

func TestPlaybackRejectsInvalidClientUpdatedAt(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":1,"positionSeconds":1,"clientUpdatedAt":"not-rfc3339"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_CLIENT_UPDATED_AT")
}

func TestEpisodeEndpoints(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	getReq := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1", nil)
	getReq.SetPathValue("id", "1")
	getReq.AddCookie(cookie)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from episode get, got %d body=%s", getRec.Code, getRec.Body.String())
	}

	patchReq := httptest.NewRequest(nethttp.MethodPatch, "/api/episodes/1", bytes.NewReader([]byte(`{"isListened":true}`)))
	patchReq.SetPathValue("id", "1")
	patchReq.AddCookie(cookie)
	patchRec := httptest.NewRecorder()
	handler.ServeHTTP(patchRec, patchReq)
	if patchRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from episode patch, got %d body=%s", patchRec.Code, patchRec.Body.String())
	}

	deleteReq := httptest.NewRequest(nethttp.MethodDelete, "/api/episodes/1/download", nil)
	deleteReq.SetPathValue("id", "1")
	deleteReq.AddCookie(cookie)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from download delete, got %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
}

func TestEpisodePatchRejectsMissingField(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/episodes/1", bytes.NewReader([]byte(`{}`)))
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_EPISODE_PATCH")
}

func TestSettingsAndJobsEndpoints(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	settingsReq := httptest.NewRequest(nethttp.MethodGet, "/api/settings", nil)
	settingsReq.AddCookie(cookie)
	settingsRec := httptest.NewRecorder()
	handler.ServeHTTP(settingsRec, settingsReq)
	if settingsRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from settings get, got %d body=%s", settingsRec.Code, settingsRec.Body.String())
	}

	jobsReq := httptest.NewRequest(nethttp.MethodGet, "/api/jobs/status", nil)
	jobsReq.AddCookie(cookie)
	jobsRec := httptest.NewRecorder()
	handler.ServeHTTP(jobsRec, jobsReq)
	if jobsRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from jobs status, got %d body=%s", jobsRec.Code, jobsRec.Body.String())
	}
}

func TestPodcastEpisodesListAndExportOPML(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	now := time.Date(2026, 4, 23, 12, 0, 0, 0, time.UTC)
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, published_at) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://cdn.example.com/1.mp3', ?)`, now)

	episodesReq := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1/episodes", nil)
	episodesReq.SetPathValue("id", "1")
	episodesReq.AddCookie(cookie)
	episodesRec := httptest.NewRecorder()
	handler.ServeHTTP(episodesRec, episodesReq)
	if episodesRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from episodes list, got %d body=%s", episodesRec.Code, episodesRec.Body.String())
	}

	exportReq := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/export-opml", nil)
	exportReq.AddCookie(cookie)
	exportRec := httptest.NewRecorder()
	handler.ServeHTTP(exportRec, exportReq)
	if exportRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from export OPML, got %d body=%s", exportRec.Code, exportRec.Body.String())
	}
	if got := exportRec.Header().Get("Content-Type"); !strings.Contains(got, "text/x-opml") {
		t.Fatalf("expected OPML content type, got %q", got)
	}
}

func TestImportOPMLValidation(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", strings.NewReader("not multipart"))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_MULTIPART")
}

func TestImportOPMLMissingFile(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "OPML_FILE_REQUIRED")
}

func newAuthedRouter(t *testing.T) (nethttp.Handler, *nethttp.Cookie) {
	t.Helper()

	handler, _ := newTestRouter(t)
	return handler, register(t, handler, "admin", "secret")
}

func newTestRouter(t *testing.T) (nethttp.Handler, *storage.DB) {
	t.Helper()

	db := newTestDB(t)
	cfg := config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}
	schedulerService := scheduler.NewService(
		db.SQL,
		log.New(io.Discard, "", 0),
		settings.NewService(db.SQL),
		func(context.Context) error { return nil },
	)
	return NewRouter(log.New(io.Discard, "", 0), cfg, db.SQL, schedulerService), db
}

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := storage.Open(path)
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	if err := storage.Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("storage.Migrate: %v", err)
	}
	return db
}

func assertErrorCode(t *testing.T, body []byte, want string) {
	t.Helper()

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("Unmarshal error payload failed: %v body=%s", err, string(body))
	}
	if payload.Error.Code != want {
		t.Fatalf("expected error code %q, got %q body=%s", want, payload.Error.Code, string(body))
	}
}

func register(t *testing.T, handler nethttp.Handler, username, password string) *nethttp.Cookie {
	t.Helper()

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"`+username+`","password":"`+password+`","confirmPassword":"`+password+`"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != nethttp.StatusOK {
		t.Fatalf("register request failed: status=%d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected registration to set a cookie")
	}
	return cookies[0]
}

func seedEpisode(t *testing.T, db *storage.DB, episodeID, podcastID int64) {
	t.Helper()
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (?, 'Podcast', 'https://example.com/feed.xml') ON CONFLICT(id) DO NOTHING`, podcastID)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (?, ?, ?, ?, ?)`,
		episodeID, podcastID, "ep-seed-"+strconv.FormatInt(episodeID, 10), "Episode", "https://cdn.example.com/audio.mp3")
}

func mustExecHTTP(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}
