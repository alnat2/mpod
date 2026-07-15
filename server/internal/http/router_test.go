package http

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"mime/multipart"
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/auth"
	"github.com/cross/mpod/server/internal/config"
	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playback"
	"github.com/cross/mpod/server/internal/playlist"
	"github.com/cross/mpod/server/internal/podcasts"
	"github.com/cross/mpod/server/internal/remote"
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

func TestProtectedRouteReturnsStableInternalErrorContractOnAuthFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := authDB.Close(); err != nil {
		t.Fatalf("authDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "AUTH_CHECK_FAILED")
}

func TestRegisterCreatesSessionAndSessionEndpointReflectsAuth(t *testing.T) {
	handler, _ := newTestRouter(t)

	body := []byte(`{"username":"admin","password":"secret"}`)
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

func TestRegisterOnPlainHTTPDoesNotSetSecureSessionCookieInProduction(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected session cookie")
	}
	if cookies[0].Secure {
		t.Fatalf("expected non-secure cookie for plain HTTP request, got %+v", cookies[0])
	}
}

func TestRegisterWithForwardedHTTPSSetsSecureSessionCookie(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected session cookie")
	}
	if !cookies[0].Secure {
		t.Fatalf("expected secure cookie for forwarded HTTPS request, got %+v", cookies[0])
	}
}

func TestSessionEndpointReportsSetupRequiredWhenNoUserExists(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/auth/session", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Authenticated bool `json:"authenticated"`
		SetupRequired bool `json:"setupRequired"`
		User          any  `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("Unmarshal session payload failed: %v", err)
	}
	if payload.Authenticated || !payload.SetupRequired || payload.User != nil {
		t.Fatalf("unexpected setup-required payload: %+v", payload)
	}
}

func TestRegisterRejectsInvalidPayload(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"admin","password":""}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_REGISTRATION")
}

func TestRegisterRejectsSecondSetupAttempt(t *testing.T) {
	handler, _ := newTestRouter(t)
	register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"other","password":"secret"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "SETUP_ALREADY_COMPLETE")
}

func TestRegisterRejectsInvalidJSON(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_JSON")
}

func TestRegisterRejectsOversizedJSONBody(t *testing.T) {
	handler, _ := newTestRouter(t)

	oversizedBody := `{"username":"` + strings.Repeat("a", maxJSONBodyBytes) + `","password":"secret"}`
	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(oversizedBody)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "REQUEST_TOO_LARGE")
}

func TestSessionEndpointReturnsStableInternalErrorContractOnAuthFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	if err := authDB.Close(); err != nil {
		t.Fatalf("authDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/auth/session", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "SESSION_CHECK_FAILED")
}

func TestRecoverAndLogDoesNotAppendJSONErrorAfterResponseStarts(t *testing.T) {
	r := &Router{logger: log.New(io.Discard, "", 0)}
	handler := r.recoverAndLog(nethttp.HandlerFunc(func(w nethttp.ResponseWriter, req *nethttp.Request) {
		w.WriteHeader(nethttp.StatusOK)
		if _, err := w.Write([]byte("partial-response")); err != nil {
			t.Fatalf("write failed: %v", err)
		}
		panic("boom")
	}))

	req := httptest.NewRequest(nethttp.MethodGet, "/panic", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 to remain after partial response, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "partial-response" {
		t.Fatalf("expected partial response body to be preserved, got %q", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("expected no appended JSON error body, got %q", rec.Body.String())
	}
}

func TestRegisterReturnsStableInternalErrorContractOnAuthFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	if err := authDB.Close(); err != nil {
		t.Fatalf("authDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "REGISTER_FAILED")
}

func TestLoginReturnsStableInternalErrorContractOnAuthFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	register(t, handler, "admin", "secret")
	if err := authDB.Close(); err != nil {
		t.Fatalf("authDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/login", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "LOGIN_FAILED")
}

func TestLogoutReturnsStableInternalErrorContractOnAuthFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := authDB.Close(); err != nil {
		t.Fatalf("authDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "LOGOUT_FAILED")
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

func TestPodcastImageProxiesArtwork(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		if req.URL.String() != "https://cdn.example.com/artwork.png" {
			t.Fatalf("unexpected image request URL: %s", req.URL.String())
		}
		return routerBinaryResponse("image/png", []byte("image-bytes")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, image_url, rss_url) VALUES (1, 'Podcast', 'https://cdn.example.com/artwork.png', 'https://example.com/feed.xml')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1/image", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("expected image/png content type, got %q", rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Cache-Control") != "private, max-age=604800" {
		t.Fatalf("expected one-week cache control, got %q", rec.Header().Get("Cache-Control"))
	}
	if rec.Body.String() != "image-bytes" {
		t.Fatalf("unexpected image body: %q", rec.Body.String())
	}
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

func TestSettingsPatchUpdatesProxyEnabledWhenConfigured(t *testing.T) {
	cfg := config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}
	handler, _ := newTestRouterWithConfig(t, cfg)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"proxyEnabled":true}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"proxyEnabled":true`) || !strings.Contains(rec.Body.String(), `"proxyConfigured":true`) {
		t.Fatalf("expected proxy-enabled settings payload, got %s", rec.Body.String())
	}
}

func TestOutboundRequestsUseDirectTransportWhenProxyDisabled(t *testing.T) {
	cfg := config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}
	handler, db, recorder := newProxyAwareRouterHarness(t, cfg)
	cookie := register(t, handler, "admin", "secret")

	createReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed-one.xml"}`)))
	createReq.AddCookie(cookie)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcast create, got %d body=%s", createRec.Code, createRec.Body.String())
	}
	recorder.assertOnlyDirect(t, "https://example.com/feed-one.xml")
	recorder.reset()

	refreshReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
	refreshReq.SetPathValue("id", "1")
	refreshReq.AddCookie(cookie)
	refreshRec := httptest.NewRecorder()
	handler.ServeHTTP(refreshRec, refreshReq)
	if refreshRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcast refresh, got %d body=%s", refreshRec.Code, refreshRec.Body.String())
	}
	recorder.assertOnlyDirect(t, "https://example.com/feed-one.xml")
	recorder.reset()

	var opmlBody bytes.Buffer
	opmlWriter := multipart.NewWriter(&opmlBody)
	opmlPart, err := opmlWriter.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := io.WriteString(opmlPart, `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Podcast Two" xmlUrl="https://example.com/feed-two.xml"/>
  </body>
</opml>`); err != nil {
		t.Fatalf("write opml failed: %v", err)
	}
	if err := opmlWriter.Close(); err != nil {
		t.Fatalf("multipart close failed: %v", err)
	}

	importReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &opmlBody)
	importReq.Header.Set("Content-Type", opmlWriter.FormDataContentType())
	importReq.AddCookie(cookie)
	importRec := httptest.NewRecorder()
	handler.ServeHTTP(importRec, importReq)
	if importRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from opml import, got %d body=%s", importRec.Code, importRec.Body.String())
	}
	recorder.assertOnlyDirect(t, "https://example.com/feed-two.xml")
	recorder.reset()

	seedEpisodeWithAudioURL(t, db, 10, 10, "https://cdn.example.com/download.mp3")
	downloadReq := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/10/download", nil)
	downloadReq.SetPathValue("id", "10")
	downloadReq.AddCookie(cookie)
	downloadRec := httptest.NewRecorder()
	handler.ServeHTTP(downloadRec, downloadReq)
	if downloadRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from download, got %d body=%s", downloadRec.Code, downloadRec.Body.String())
	}
	recorder.assertOnlyDirect(t, "https://cdn.example.com/download.mp3")
	recorder.reset()

	seedEpisodeWithAudioURL(t, db, 11, 11, "https://cdn.example.com/audio.mp3")
	audioReq := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/11/audio", nil)
	audioReq.SetPathValue("id", "11")
	audioReq.AddCookie(cookie)
	audioRec := httptest.NewRecorder()
	handler.ServeHTTP(audioRec, audioReq)
	if audioRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from audio proxy, got %d body=%s", audioRec.Code, audioRec.Body.String())
	}
	recorder.assertOnlyDirect(t, "https://cdn.example.com/audio.mp3")
	recorder.reset()

	proxyStatusReq := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	proxyStatusReq.AddCookie(cookie)
	proxyStatusRec := httptest.NewRecorder()
	handler.ServeHTTP(proxyStatusRec, proxyStatusReq)
	if proxyStatusRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from proxy status, got %d body=%s", proxyStatusRec.Code, proxyStatusRec.Body.String())
	}
	if !strings.Contains(proxyStatusRec.Body.String(), `"status":"off"`) {
		t.Fatalf("expected off proxy status when disabled, got %s", proxyStatusRec.Body.String())
	}
	if len(recorder.direct) != 0 || len(recorder.proxy) != 0 {
		t.Fatalf("expected proxy status to avoid outbound lookup when disabled, got direct=%v proxy=%v", recorder.direct, recorder.proxy)
	}
}

func TestOutboundRequestsUseProxyTransportWhenProxyEnabled(t *testing.T) {
	cfg := config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}
	handler, db, recorder := newProxyAwareRouterHarness(t, cfg)
	cookie := register(t, handler, "admin", "secret")
	enableProxyForTest(t, handler, cookie)

	createReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed-one.xml"}`)))
	createReq.AddCookie(cookie)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcast create, got %d body=%s", createRec.Code, createRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://example.com/feed-one.xml")
	recorder.reset()

	refreshReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
	refreshReq.SetPathValue("id", "1")
	refreshReq.AddCookie(cookie)
	refreshRec := httptest.NewRecorder()
	handler.ServeHTTP(refreshRec, refreshReq)
	if refreshRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcast refresh, got %d body=%s", refreshRec.Code, refreshRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://example.com/feed-one.xml")
	recorder.reset()

	var opmlBody bytes.Buffer
	opmlWriter := multipart.NewWriter(&opmlBody)
	opmlPart, err := opmlWriter.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := io.WriteString(opmlPart, `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Podcast Two" xmlUrl="https://example.com/feed-two.xml"/>
  </body>
</opml>`); err != nil {
		t.Fatalf("write opml failed: %v", err)
	}
	if err := opmlWriter.Close(); err != nil {
		t.Fatalf("multipart close failed: %v", err)
	}

	importReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &opmlBody)
	importReq.Header.Set("Content-Type", opmlWriter.FormDataContentType())
	importReq.AddCookie(cookie)
	importRec := httptest.NewRecorder()
	handler.ServeHTTP(importRec, importReq)
	if importRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from opml import, got %d body=%s", importRec.Code, importRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://example.com/feed-two.xml")
	recorder.reset()

	seedEpisodeWithAudioURL(t, db, 10, 10, "https://cdn.example.com/download.mp3")
	downloadReq := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/10/download", nil)
	downloadReq.SetPathValue("id", "10")
	downloadReq.AddCookie(cookie)
	downloadRec := httptest.NewRecorder()
	handler.ServeHTTP(downloadRec, downloadReq)
	if downloadRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from download, got %d body=%s", downloadRec.Code, downloadRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://cdn.example.com/download.mp3")
	recorder.reset()

	seedEpisodeWithAudioURL(t, db, 11, 11, "https://cdn.example.com/audio.mp3")
	audioReq := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/11/audio", nil)
	audioReq.SetPathValue("id", "11")
	audioReq.AddCookie(cookie)
	audioRec := httptest.NewRecorder()
	handler.ServeHTTP(audioRec, audioReq)
	if audioRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from audio proxy, got %d body=%s", audioRec.Code, audioRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://cdn.example.com/audio.mp3")
	recorder.reset()

	proxyStatusReq := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	proxyStatusReq.AddCookie(cookie)
	proxyStatusRec := httptest.NewRecorder()
	handler.ServeHTTP(proxyStatusRec, proxyStatusReq)
	if proxyStatusRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from proxy status, got %d body=%s", proxyStatusRec.Code, proxyStatusRec.Body.String())
	}
	if !strings.Contains(proxyStatusRec.Body.String(), `"status":"ok"`) {
		t.Fatalf("expected ok proxy status when enabled, got %s", proxyStatusRec.Body.String())
	}
	recorder.assertOnlyProxy(t, "https://ipwho.is/")
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

func TestLoginRejectsInvalidJSON(t *testing.T) {
	handler, _ := newTestRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/login", bytes.NewReader([]byte(`{`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_JSON")
}

func TestSessionEndpointShowsLoggedOutStateAfterLogout(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	logoutReq := httptest.NewRequest(nethttp.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	logoutRec := httptest.NewRecorder()
	handler.ServeHTTP(logoutRec, logoutReq)
	if logoutRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from logout, got %d body=%s", logoutRec.Code, logoutRec.Body.String())
	}

	sessionReq := httptest.NewRequest(nethttp.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(cookie)
	sessionRec := httptest.NewRecorder()
	handler.ServeHTTP(sessionRec, sessionReq)

	if sessionRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from session endpoint, got %d body=%s", sessionRec.Code, sessionRec.Body.String())
	}
	if !strings.Contains(sessionRec.Body.String(), `"authenticated":false`) || !strings.Contains(sessionRec.Body.String(), `"setupRequired":false`) {
		t.Fatalf("unexpected logged-out session payload: %s", sessionRec.Body.String())
	}
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

func TestPodcastsListReturnsEmptyArrayWhenNoSubscriptions(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"podcasts":[]`) {
		t.Fatalf("expected empty podcasts array, got %s", rec.Body.String())
	}
}

func TestPodcastsListReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PODCAST_LIST_FAILED")
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

func TestPodcastGetReturnsPodcast(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"title":"Podcast One"`) {
		t.Fatalf("unexpected podcast get payload: %s", rec.Body.String())
	}
}

func TestPodcastGetReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PODCAST_GET_FAILED")
}

func TestPodcastsCreateImportsFeed(t *testing.T) {
	feedBody := testRouterRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(feedBody), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml#fragment"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"title":"Test Podcast"`) || !strings.Contains(rec.Body.String(), `"rssUrl":"https://example.com/feed.xml"`) {
		t.Fatalf("unexpected podcast create payload: %s", rec.Body.String())
	}

	assertTableCount(t, db, `SELECT COUNT(*) FROM podcasts`, 1)
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 1)
}

func TestPodcastsCreateRejectsDuplicateSubscription(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	body := []byte(`{"rssUrl":"https://example.com/feed.xml"}`)

	firstReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader(body))
	firstReq.AddCookie(cookie)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != nethttp.StatusOK {
		t.Fatalf("expected first create to succeed, got %d body=%s", firstRec.Code, firstRec.Body.String())
	}

	secondReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader(body))
	secondReq.AddCookie(cookie)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)

	if secondRec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", secondRec.Code, secondRec.Body.String())
	}
	assertErrorCode(t, secondRec.Body.Bytes(), "DUPLICATE_SUBSCRIPTION")
}

func TestPodcastsCreateRejectsInvalidFeedURL(t *testing.T) {
	handler, _ := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"not-a-url"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_FEED_URL")
}

func TestPodcastsCreateRejectsFeedFetchFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return nil, io.EOF
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "FEED_FETCH_FAILED")
}

func TestPodcastsCreateRejectsFeedParseFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse("not xml"), nil
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "FEED_PARSE_FAILED")
}

func TestPodcastsCreateRejectsNoPlayableEpisodes(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Silent Podcast</title>
    <item>
      <title>Episode Without Audio</title>
      <guid>guid-1</guid>
    </item>
  </channel>
</rss>`), nil
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "NO_PLAYABLE_EPISODES")
}

func TestPodcastsCreateReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Broken Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, client)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PODCAST_CREATE_FAILED")
}

func TestPodcastRefreshReturnsNewEpisodes(t *testing.T) {
	feedBody := testRouterRSSFeed("Test Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(feedBody), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	createReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	createReq.AddCookie(cookie)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != nethttp.StatusOK {
		t.Fatalf("expected create to succeed, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	feedBody = testRouterRSSFeedWithTwoEpisodes(
		"Test Podcast",
		"Episode One Updated", "guid-1", "https://cdn.example.com/1-new.mp3",
		"Episode Two", "guid-2", "https://cdn.example.com/2.mp3",
	)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"success":true`) || !strings.Contains(rec.Body.String(), `"newEpisodes":1`) {
		t.Fatalf("unexpected podcast refresh payload: %s", rec.Body.String())
	}

	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 1`, 2)
}

func TestPodcastRefreshRejectsFeedFetchFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return nil, io.EOF
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "FEED_FETCH_FAILED")
}

func TestPodcastRefreshNotFound(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/999/refresh", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PODCAST_NOT_FOUND")
}

func TestPodcastsRefreshAllRefreshesSubscribedPodcasts(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		switch req.URL.Path {
		case "/one.xml":
			return routerXMLResponse(testRouterRSSFeed("One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		case "/two.xml":
			return routerXMLResponse(testRouterRSSFeed("Two", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")), nil
		default:
			t.Fatalf("unexpected feed request path %q", req.URL.Path)
			return nil, nil
		}
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'One', 'https://example.com/one.xml')`)
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (2, 'Two', 'https://example.com/two.xml')`)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/refresh-all", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"success":true`) {
		t.Fatalf("unexpected refresh-all payload: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"state":"running"`) {
		t.Fatalf("expected running refresh-all payload: %s", rec.Body.String())
	}
	waitForTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 2)

	jobsReq := httptest.NewRequest(nethttp.MethodGet, "/api/jobs/status", nil)
	jobsReq.AddCookie(cookie)
	jobsRec := httptest.NewRecorder()
	handler.ServeHTTP(jobsRec, jobsReq)

	if jobsRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from jobs status, got %d body=%s", jobsRec.Code, jobsRec.Body.String())
	}
	if !strings.Contains(jobsRec.Body.String(), `"state":"completed"`) {
		t.Fatalf("expected completed scheduler state after refresh-all, got %s", jobsRec.Body.String())
	}
	if !strings.Contains(jobsRec.Body.String(), `"lastRunAt"`) {
		t.Fatalf("expected refresh-all to record lastRunAt, got %s", jobsRec.Body.String())
	}
	if !strings.Contains(jobsRec.Body.String(), `"lastTrigger":"manual"`) {
		t.Fatalf("expected refresh-all to record manual trigger, got %s", jobsRec.Body.String())
	}
}

func TestPodcastsRefreshAllReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/refresh-all", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PODCASTS_REFRESH_ALL_FAILED")
}

func TestPodcastsRefreshAllRejectsConcurrentRun(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		close(requestStarted)
		<-releaseRequest
		return routerXMLResponse(testRouterRSSFeed("Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)

	firstDone := make(chan int, 1)
	go func() {
		req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/refresh-all", nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		firstDone <- rec.Code
	}()

	<-requestStarted
	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/refresh-all", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusConflict, "REFRESH_ALREADY_RUNNING")

	close(releaseRequest)
	if code := <-firstDone; code != nethttp.StatusAccepted {
		t.Fatalf("expected first refresh-all to be accepted with 202, got %d", code)
	}
}

func TestPodcastRefreshRejectsConcurrentRefresh(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		close(requestStarted)
		<-releaseRequest
		return routerXMLResponse(testRouterRSSFeed("Podcast", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)

	firstDone := make(chan int, 1)
	go func() {
		req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
		req.SetPathValue("id", "1")
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		firstDone <- rec.Code
	}()

	<-requestStarted
	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/refresh", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusConflict {
		t.Fatalf("expected 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "REFRESH_ALREADY_RUNNING")

	close(releaseRequest)
	if code := <-firstDone; code != nethttp.StatusOK {
		t.Fatalf("expected first refresh to finish with 200, got %d", code)
	}
}

func TestPodcastDeleteRemovesCascadeDataAndFiles(t *testing.T) {
	downloadsDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	})
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?)`, downloadPath)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecHTTP(t, db, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 5, CURRENT_TIMESTAMP)`)

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/podcasts/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"success":true`) {
		t.Fatalf("unexpected podcast delete payload: %s", rec.Body.String())
	}

	assertTableCount(t, db, `SELECT COUNT(*) FROM podcasts`, 0)
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 0)
	assertTableCount(t, db, `SELECT COUNT(*) FROM playlist`, 0)
	assertTableCount(t, db, `SELECT COUNT(*) FROM playback`, 0)
	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected download file removal, stat err=%v", err)
	}
}

func TestPodcastDeleteNotFound(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/podcasts/999", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PODCAST_NOT_FOUND")
}

func TestPodcastDeleteReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/podcasts/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PODCAST_DELETE_FAILED")
}

func TestPlaylistEndpoints(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)
	mustExecHTTP(t, db, `UPDATE episodes SET is_listened = 1 WHERE id = 1`)

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
			Episode   struct {
				IsListened bool `json:"isListened"`
			} `json:"episode"`
		} `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("Unmarshal playlist list failed: %v", err)
	}
	if len(listPayload.Items) != 1 || listPayload.Items[0].EpisodeID != 1 {
		t.Fatalf("unexpected playlist payload: %+v", listPayload)
	}
	if listPayload.Items[0].Episode.IsListened {
		t.Fatalf("expected playlist add to mark episode unlistened")
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

func TestPlaylistListReturnsEmptyArrayWhenNoItems(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playlist", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"items":[]`) {
		t.Fatalf("expected empty playlist array, got %s", rec.Body.String())
	}
}

func TestPlaylistListReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playlist", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PLAYLIST_LIST_FAILED")
}

func TestPlaylistAddReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playlist", bytes.NewReader([]byte(`{"episodeId":1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PLAYLIST_ADD_FAILED")
}

func TestPlaylistReorderReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/playlist/reorder", bytes.NewReader([]byte(`{"episodeIds":[1]}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PLAYLIST_REORDER_FAILED")
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

func TestPlaylistAddRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playlist", bytes.NewReader([]byte(`{"episodeId":999}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestPlaylistReorderRejectsInvalidJSON(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/playlist/reorder", bytes.NewReader([]byte(`{`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_JSON")
}

func TestPlaylistRemoveReturnsServerErrorWhenDownloadDeletionFails(t *testing.T) {
	downloadsDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	})
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?)`, downloadPath)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/playlist/1", nil)
	req.SetPathValue("episodeId", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PLAYLIST_REMOVE_FAILED")

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("count playlist rows: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected playlist item to remain after failed download delete, got %d rows", playlistCount)
	}
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
	if !strings.Contains(postRec.Body.String(), `"nextEpisodeId":null`) {
		t.Fatalf("expected null nextEpisodeId in playback response, got %s", postRec.Body.String())
	}
}

func TestPlaybackCompletionReturnsFallbackEpisodeForLastPlaylistItem(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3', 600, 0)`)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)
	mustExecHTTP(t, db, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)
	mustExecHTTP(t, db, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (2, 590, CURRENT_TIMESTAMP)`)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":3,"positionSeconds":600,"durationSeconds":600,"completed":true}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playback completion, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Playback struct {
			EpisodeID int64 `json:"episodeId"`
		} `json:"playback"`
		NextEpisodeID *int64 `json:"nextEpisodeId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal playback response: %v", err)
	}
	if payload.NextEpisodeID == nil || *payload.NextEpisodeID != 1 {
		t.Fatalf("expected fallback episode 1, got %+v", payload.NextEpisodeID)
	}
}

func TestPodcastMarkAllListenedEndpoint(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (1, 1, 'ep-1', 'One', 'https://example.com/1.mp3', 0)`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (2, 1, 'ep-2', 'Two', 'https://example.com/2.mp3', 0)`)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1), (2, 2)`)
	mustExecHTTP(t, db, `INSERT INTO active_playback (singleton_id, episode_id, last_updated) VALUES (1, 1, CURRENT_TIMESTAMP)`)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/1/mark-all-listened", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"success":true`) || !strings.Contains(rec.Body.String(), `"markedEpisodes":2`) {
		t.Fatalf("unexpected mark all listened payload: %s", rec.Body.String())
	}
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes WHERE podcast_id = 1 AND is_listened = 1`, 2)
	assertTableCount(t, db, `SELECT COUNT(*) FROM playlist`, 0)
	assertTableCount(t, db, `SELECT COUNT(*) FROM active_playback WHERE episode_id IS NOT NULL`, 0)
}

func TestPodcastMarkAllListenedRejectsMissingPodcast(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/999/mark-all-listened", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PODCAST_NOT_FOUND")
}

func TestPlaybackActiveEndpointSetsActiveEpisode(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	req := httptest.NewRequest(nethttp.MethodPut, "/api/playback/active", bytes.NewReader([]byte(`{"episodeId":1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"episodeId":1`) || !strings.Contains(rec.Body.String(), `"lastUpdated"`) {
		t.Fatalf("expected active playback payload, got %s", rec.Body.String())
	}
}

func TestPlaybackActiveEndpointRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPut, "/api/playback/active", bytes.NewReader([]byte(`{"episodeId":999}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestPlaybackActiveEndpointRejectsEpisodeOutsidePlaylist(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodPut, "/api/playback/active", bytes.NewReader([]byte(`{"episodeId":1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_IN_PLAYLIST")
}

func TestPlaybackActiveEndpointRequiresAuth(t *testing.T) {
	handler, db := newTestRouter(t)
	seedEpisode(t, db, 1, 1)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	req := httptest.NewRequest(nethttp.MethodPut, "/api/playback/active", bytes.NewReader([]byte(`{"episodeId":1}`)))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
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

func TestPlaybackRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":999,"positionSeconds":1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestPlaybackRejectsInvalidPosition(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":1,"positionSeconds":-1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_POSITION")
}

func TestPlaybackGetReturnsSavedState(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)
	now := time.Date(2026, 4, 24, 8, 0, 0, 0, time.UTC)
	mustExecHTTP(t, db, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 42, ?)`, now)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playback/1", nil)
	req.SetPathValue("episodeId", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"episodeId":1`) || !strings.Contains(rec.Body.String(), `"positionSeconds":42`) {
		t.Fatalf("unexpected playback payload: %s", rec.Body.String())
	}
}

func TestPlaybackGetReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playback/1", nil)
	req.SetPathValue("episodeId", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "PLAYBACK_LOAD_FAILED")
}

func TestPlaybackPostReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":1,"positionSeconds":1}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PLAYBACK_UPDATE_FAILED")
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

func TestEpisodeDownloadEndpointDownloadsFile(t *testing.T) {
	downloadsDir := t.TempDir()
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerBinaryResponse("audio/mpeg", []byte("audio-bytes")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	}, client)
	cookie := register(t, handler, "admin", "secret")

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode', ?)`, "https://cdn.example.com/episode.mp3")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/1/download", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"success":true`) || !strings.Contains(rec.Body.String(), `"downloaded":true`) {
		t.Fatalf("unexpected episode download payload: %s", rec.Body.String())
	}

	var downloadedPath string
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("load downloaded_path failed: %v", err)
	}
	if downloadedPath == "" {
		t.Fatalf("expected downloaded_path to be stored")
	}
	if _, err := os.Stat(downloadedPath); err != nil {
		t.Fatalf("expected downloaded file to exist, stat err=%v", err)
	}
}

func TestEpisodeAudioServesDownloadedFile(t *testing.T) {
	downloadsDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	})
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("local-audio"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://cdn.example.com/episode.mp3', ?)`, downloadPath)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "local-audio" {
		t.Fatalf("expected local audio body, got %q", rec.Body.String())
	}
}

func TestEpisodeAudioFallsBackToRemoteWhenLocalFileIsNonPlayable(t *testing.T) {
	downloadsDir := t.TempDir()
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		if req.URL.String() != "https://cdn.example.com/episode.mp3" {
			t.Fatalf("unexpected audio request URL: %s", req.URL.String())
		}
		return routerBinaryResponse("audio/mpeg", []byte("remote-audio")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	}, client)
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("<html>not audio</html>"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://cdn.example.com/episode.mp3', ?)`, downloadPath)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "remote-audio" {
		t.Fatalf("expected remote audio fallback body, got %q", rec.Body.String())
	}

	var downloadedPathAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPathAfter); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPathAfter.Valid {
		t.Fatalf("expected downloaded_path to be cleared after bad local file, got %q", downloadedPathAfter.String)
	}
}

func TestEpisodeAudioProxiesRemoteAudioWhenNotDownloaded(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		if req.URL.String() != "https://cdn.example.com/audio.mp3" {
			t.Fatalf("unexpected audio request URL: %s", req.URL.String())
		}
		if got := req.Header.Get("User-Agent"); got != audioProxyUserAgent {
			t.Fatalf("expected User-Agent %q, got %q", audioProxyUserAgent, got)
		}
		if got := req.Header.Get("Accept"); got != audioProxyAccept {
			t.Fatalf("expected Accept %q, got %q", audioProxyAccept, got)
		}
		return routerBinaryResponse("audio/mpeg", []byte("remote-audio")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Fatalf("expected audio/mpeg content type, got %q", got)
	}
	if rec.Body.String() != "remote-audio" {
		t.Fatalf("expected proxied remote audio body, got %q", rec.Body.String())
	}
}

func TestEpisodeAudioNormalizesGenericBinaryRemoteAudioContentType(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerBinaryResponse("application/octet-stream", []byte("ID3\x03\x00\x00remote-audio")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Fatalf("expected audio/mpeg content type, got %q", got)
	}
	if !bytes.Equal(rec.Body.Bytes(), []byte("ID3\x03\x00\x00remote-audio")) {
		t.Fatalf("expected proxied remote audio body, got %q", rec.Body.Bytes())
	}
}

func TestEpisodeAudioForwardsRangeHeaderToRemoteAudio(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		if got := req.Header.Get("Range"); got != "bytes=10-19" {
			t.Fatalf("expected Range header to be forwarded, got %q", got)
		}
		resp := routerBinaryResponse("audio/mpeg", []byte("partial-audio"))
		resp.StatusCode = nethttp.StatusPartialContent
		resp.Status = "206 Partial Content"
		resp.Header.Set("Accept-Ranges", "bytes")
		resp.Header.Set("Content-Range", "bytes 10-19/100")
		return resp, nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.Header.Set("Range", "bytes=10-19")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusPartialContent {
		t.Fatalf("expected 206, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("expected Accept-Ranges bytes, got %q", got)
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 10-19/100" {
		t.Fatalf("expected Content-Range to be forwarded, got %q", got)
	}
	if rec.Body.String() != "partial-audio" {
		t.Fatalf("expected proxied partial audio body, got %q", rec.Body.String())
	}
}

func TestEpisodeAudioRejectsNonAudioRemoteResponse(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerBinaryResponse("text/html; charset=utf-8", []byte("<html>not audio</html>")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1/audio", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadGateway {
		t.Fatalf("expected 502, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "AUDIO_LOAD_FAILED")
	if !strings.Contains(rec.Body.String(), "Audio source is not playable") {
		t.Fatalf("expected playable audio error, got %s", rec.Body.String())
	}
}

func TestAPIFlowSubscribeDownloadPlaylistAndCompletePlayback(t *testing.T) {
	downloadsDir := t.TempDir()
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		switch req.URL.Path {
		case "/feed.xml":
			return routerXMLResponse(testRouterRSSFeed("Flow Podcast", "Flow Episode", "guid-1", "https://cdn.example.com/episode.mp3")), nil
		case "/episode.mp3":
			return routerBinaryResponse("audio/mpeg", []byte("audio-bytes")), nil
		default:
			t.Fatalf("unexpected request path %q", req.URL.Path)
			return nil, nil
		}
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	}, client)
	cookie := register(t, handler, "admin", "secret")

	createReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts", bytes.NewReader([]byte(`{"rssUrl":"https://example.com/feed.xml"}`)))
	createReq.AddCookie(cookie)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcast create, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	addReq := httptest.NewRequest(nethttp.MethodPost, "/api/playlist", bytes.NewReader([]byte(`{"episodeId":1}`)))
	addReq.AddCookie(cookie)
	addRec := httptest.NewRecorder()
	handler.ServeHTTP(addRec, addReq)
	if addRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playlist add, got %d body=%s", addRec.Code, addRec.Body.String())
	}

	downloadReq := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/1/download", nil)
	downloadReq.SetPathValue("id", "1")
	downloadReq.AddCookie(cookie)
	downloadRec := httptest.NewRecorder()
	handler.ServeHTTP(downloadRec, downloadReq)
	if downloadRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from episode download, got %d body=%s", downloadRec.Code, downloadRec.Body.String())
	}

	playbackReq := httptest.NewRequest(nethttp.MethodPost, "/api/playback", bytes.NewReader([]byte(`{"episodeId":1,"positionSeconds":300,"durationSeconds":300,"completed":true}`)))
	playbackReq.AddCookie(cookie)
	playbackRec := httptest.NewRecorder()
	handler.ServeHTTP(playbackRec, playbackReq)
	if playbackRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playback completion, got %d body=%s", playbackRec.Code, playbackRec.Body.String())
	}

	episodeReq := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1", nil)
	episodeReq.SetPathValue("id", "1")
	episodeReq.AddCookie(cookie)
	episodeRec := httptest.NewRecorder()
	handler.ServeHTTP(episodeRec, episodeReq)
	if episodeRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from episode get, got %d body=%s", episodeRec.Code, episodeRec.Body.String())
	}
	if !strings.Contains(episodeRec.Body.String(), `"isListened":true`) || !strings.Contains(episodeRec.Body.String(), `"downloaded":false`) {
		t.Fatalf("unexpected episode payload after completion: %s", episodeRec.Body.String())
	}

	playlistReq := httptest.NewRequest(nethttp.MethodGet, "/api/playlist", nil)
	playlistReq.AddCookie(cookie)
	playlistRec := httptest.NewRecorder()
	handler.ServeHTTP(playlistRec, playlistReq)
	if playlistRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from playlist get, got %d body=%s", playlistRec.Code, playlistRec.Body.String())
	}
	if strings.Contains(playlistRec.Body.String(), `"episodeId":1`) {
		t.Fatalf("expected completed episode to be removed from playlist, got %s", playlistRec.Body.String())
	}

	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPath); err != nil {
		t.Fatalf("load downloaded_path failed: %v", err)
	}
	if downloadedPath.Valid && downloadedPath.String != "" {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPath.String)
	}
}

func TestAPIFlowRegisterLogoutLoginSettingsAndOPMLImport(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Imported Podcast", "Imported Episode", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}, client)

	registerReq := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	registerRec := httptest.NewRecorder()
	handler.ServeHTTP(registerRec, registerReq)
	if registerRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from register, got %d body=%s", registerRec.Code, registerRec.Body.String())
	}
	cookies := registerRec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected register to set session cookie")
	}
	cookie := cookies[0]

	logoutReq := httptest.NewRequest(nethttp.MethodPost, "/api/auth/logout", nil)
	logoutReq.AddCookie(cookie)
	logoutRec := httptest.NewRecorder()
	handler.ServeHTTP(logoutRec, logoutReq)
	if logoutRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from logout, got %d body=%s", logoutRec.Code, logoutRec.Body.String())
	}

	loginReq := httptest.NewRequest(nethttp.MethodPost, "/api/auth/login", bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)))
	loginRec := httptest.NewRecorder()
	handler.ServeHTTP(loginRec, loginReq)
	if loginRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from login, got %d body=%s", loginRec.Code, loginRec.Body.String())
	}
	loginCookies := loginRec.Result().Cookies()
	if len(loginCookies) == 0 {
		t.Fatalf("expected login to set session cookie")
	}
	cookie = loginCookies[0]

	settingsReq := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"dailyRefreshTime":"08:45","playbackSpeed":"Speed 2x","proxyEnabled":true}`)))
	settingsReq.AddCookie(cookie)
	settingsRec := httptest.NewRecorder()
	handler.ServeHTTP(settingsRec, settingsReq)
	if settingsRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from settings patch, got %d body=%s", settingsRec.Code, settingsRec.Body.String())
	}
	if !strings.Contains(settingsRec.Body.String(), `"dailyRefreshTime":"08:45"`) ||
		!strings.Contains(settingsRec.Body.String(), `"playbackSpeed":"Speed 2x"`) ||
		!strings.Contains(settingsRec.Body.String(), `"proxyEnabled":true`) {
		t.Fatalf("unexpected settings payload: %s", settingsRec.Body.String())
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := io.WriteString(fileWriter, `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Imported Podcast" xmlUrl="https://example.com/feed.xml"/>
  </body>
</opml>`); err != nil {
		t.Fatalf("write opml failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	importReq := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	importReq.Header.Set("Content-Type", writer.FormDataContentType())
	importReq.AddCookie(cookie)
	importRec := httptest.NewRecorder()
	handler.ServeHTTP(importRec, importReq)
	if importRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from import, got %d body=%s", importRec.Code, importRec.Body.String())
	}
	if !strings.Contains(importRec.Body.String(), `"imported":1`) {
		t.Fatalf("unexpected import payload: %s", importRec.Body.String())
	}

	listReq := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts", nil)
	listReq.AddCookie(cookie)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from podcasts list, got %d body=%s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"title":"Imported Podcast"`) {
		t.Fatalf("expected imported podcast in list, got %s", listRec.Body.String())
	}

	assertTableCount(t, db, `SELECT COUNT(*) FROM podcasts`, 1)
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 1)
}

func TestEpisodeGetNotFound(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/999", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestEpisodeGetIncludesDescription(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, description, audio_url) VALUES (1, 1, 'ep-1', 'Episode', '<p>These are <a href="https://example.com/notes">show notes</a>.</p>', 'https://example.com/audio.mp3')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"description":"These are show notes (https://example.com/notes)."`) {
		t.Fatalf("expected sanitized description in episode payload, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"showNotes":"These are show notes (https://example.com/notes)."`) {
		t.Fatalf("expected showNotes in episode payload, got %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `<a href=`) || strings.Contains(rec.Body.String(), `&nbsp;`) {
		t.Fatalf("expected no raw html leftovers in episode payload, got %s", rec.Body.String())
	}
}

func TestEpisodeGetReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes/1", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "EPISODE_GET_FAILED")
}

func TestPodcastEpisodesListIncludesSanitizedShowNotes(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	now := time.Date(2026, 4, 23, 12, 0, 0, 0, time.UTC)
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, description, audio_url, published_at) VALUES (1, 1, 'ep-1', 'Episode 1', '<p>Read <a href="https://example.com/post">more</a></p>', 'https://cdn.example.com/1.mp3', ?)`, now)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1/episodes", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"showNotes":"Read more (https://example.com/post)"`) {
		t.Fatalf("expected sanitized showNotes in podcast episodes payload, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"description":"Read more (https://example.com/post)"`) {
		t.Fatalf("expected sanitized description in podcast episodes payload, got %s", rec.Body.String())
	}
}

func TestEpisodesListReturnsAllEpisodes(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://cdn.example.com/1.mp3')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/episodes", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"id":1`) {
		t.Fatalf("expected episode in payload, got %s", rec.Body.String())
	}
}

func TestPlaybackQueueReturnsPlaybackReadyEpisodes(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://cdn.example.com/1.mp3')`)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playback/queue", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"podcastTitle":"Podcast One"`) {
		t.Fatalf("expected playback-ready queue payload, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"activePlayback":null`) {
		t.Fatalf("expected null activePlayback in queue payload, got %s", rec.Body.String())
	}
}

func TestPlaybackQueueReturnsActivePlayback(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	seedEpisode(t, db, 1, 1)
	mustExecHTTP(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecHTTP(t, db, `INSERT INTO active_playback (singleton_id, episode_id, last_updated) VALUES (1, 1, ?)`, time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC))

	req := httptest.NewRequest(nethttp.MethodGet, "/api/playback/queue", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"activePlayback":{"episodeId":1`) {
		t.Fatalf("expected activePlayback in queue payload, got %s", rec.Body.String())
	}
}

func TestEpisodeDownloadRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/999/download", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestEpisodeDownloadDeleteRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/episodes/999/download", nil)
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
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

func TestEpisodePatchRejectsInvalidJSON(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/episodes/1", bytes.NewReader([]byte(`{`)))
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_JSON")
}

func TestEpisodePatchRejectsUnknownEpisode(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/episodes/999", bytes.NewReader([]byte(`{"isListened":true}`)))
	req.SetPathValue("id", "999")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_NOT_FOUND")
}

func TestEpisodePatchKeepsEpisodeUnlistenedWhenDownloadDeletionFails(t *testing.T) {
	downloadsDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	})
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 0)`, downloadPath)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/episodes/1", bytes.NewReader([]byte(`{"isListened":true}`)))
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_PATCH_FAILED")

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened after failed delete")
	}
}

func TestEpisodeDownloadReturnsServerErrorOnClientFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return nil, io.EOF
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode', ?)`, "https://cdn.example.com/episode.mp3")

	req := httptest.NewRequest(nethttp.MethodPost, "/api/episodes/1/download", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "DOWNLOAD_FAILED")
}

func TestEpisodeDownloadDeleteReturnsServerErrorWhenFileDeletionFails(t *testing.T) {
	downloadsDir := t.TempDir()
	handler, db := newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: downloadsDir,
	})
	cookie := register(t, handler, "admin", "secret")

	downloadPath := filepath.Join(downloadsDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?)`, downloadPath)

	req := httptest.NewRequest(nethttp.MethodDelete, "/api/episodes/1/download", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "DOWNLOAD_DELETE_FAILED")
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
	if !strings.Contains(settingsRec.Body.String(), `"playbackSpeed":"Speed 1.3x"`) {
		t.Fatalf("expected default playback speed in settings payload, got %s", settingsRec.Body.String())
	}
	if !strings.Contains(settingsRec.Body.String(), `"proxyEnabled":false`) || !strings.Contains(settingsRec.Body.String(), `"proxyConfigured":false`) {
		t.Fatalf("expected proxy fields in settings payload, got %s", settingsRec.Body.String())
	}

	jobsReq := httptest.NewRequest(nethttp.MethodGet, "/api/jobs/status", nil)
	jobsReq.AddCookie(cookie)
	jobsRec := httptest.NewRecorder()
	handler.ServeHTTP(jobsRec, jobsReq)
	if jobsRec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from jobs status, got %d body=%s", jobsRec.Code, jobsRec.Body.String())
	}
	if !strings.Contains(jobsRec.Body.String(), `"state":"idle"`) {
		t.Fatalf("expected idle scheduler state, got %s", jobsRec.Body.String())
	}
	if !strings.Contains(jobsRec.Body.String(), `"timezone":"UTC"`) {
		t.Fatalf("expected UTC timezone in scheduler payload, got %s", jobsRec.Body.String())
	}
}

func TestProxyStatusEndpointReturnsOffWhenDisabled(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"off"`) {
		t.Fatalf("expected off status, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"proxyEnabled":false`) || !strings.Contains(rec.Body.String(), `"proxyConfigured":false`) {
		t.Fatalf("expected proxy flags in payload, got %s", rec.Body.String())
	}
}

func TestProxyStatusEndpointReturnsObservedIdentityWhenEnabled(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		if req.URL.String() != "https://ipwho.is/" {
			t.Fatalf("unexpected proxy status request URL: %s", req.URL.String())
		}
		return routerJSONResponse(`{"success":true,"ip":"198.51.100.10","country":"Germany"}`), nil
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}, client)
	cookie := register(t, handler, "admin", "secret")

	patchReq := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"proxyEnabled":true}`)))
	patchReq.AddCookie(cookie)
	patchRec := httptest.NewRecorder()
	handler.ServeHTTP(patchRec, patchReq)
	if patchRec.Code != nethttp.StatusOK {
		t.Fatalf("expected settings patch to enable proxy, got %d body=%s", patchRec.Code, patchRec.Body.String())
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("expected ok status, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"externalIp":"198.51.100.10"`) || !strings.Contains(rec.Body.String(), `"country":"Germany"`) {
		t.Fatalf("expected observed identity payload, got %s", rec.Body.String())
	}
}

func TestProxyStatusEndpointReturnsErrorStateWhenLookupFails(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return nil, io.EOF
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
		SOCKS5Host:   "127.0.0.1",
		SOCKS5Port:   "1080",
	}, client)
	cookie := register(t, handler, "admin", "secret")

	patchReq := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"proxyEnabled":true}`)))
	patchReq.AddCookie(cookie)
	patchRec := httptest.NewRecorder()
	handler.ServeHTTP(patchRec, patchReq)
	if patchRec.Code != nethttp.StatusOK {
		t.Fatalf("expected settings patch to enable proxy, got %d body=%s", patchRec.Code, patchRec.Body.String())
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"error"`) {
		t.Fatalf("expected error status, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"error":"request proxy status`) {
		t.Fatalf("expected lookup error details, got %s", rec.Body.String())
	}
}

func TestProxyStatusEndpointReturnsStableInternalErrorContractWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/proxy/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "PROXY_STATUS_FAILED")
}

func TestSettingsGetReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/settings", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "SETTINGS_LOAD_FAILED")
}

func TestJobsStatusReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/jobs/status", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "JOBS_STATUS_FAILED")
}

func TestSettingsPatchRejectsMissingFields(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_SETTINGS")
}

func TestSettingsEndpointsRequireAuth(t *testing.T) {
	handler, _ := newTestRouter(t)

	getReq := httptest.NewRequest(nethttp.MethodGet, "/api/settings", nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401 from settings get, got %d body=%s", getRec.Code, getRec.Body.String())
	}
	assertErrorCode(t, getRec.Body.Bytes(), "UNAUTHORIZED")

	patchReq := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"playbackSpeed":"Speed 2x"}`)))
	patchRec := httptest.NewRecorder()
	handler.ServeHTTP(patchRec, patchReq)
	if patchRec.Code != nethttp.StatusUnauthorized {
		t.Fatalf("expected 401 from settings patch, got %d body=%s", patchRec.Code, patchRec.Body.String())
	}
	assertErrorCode(t, patchRec.Body.Bytes(), "UNAUTHORIZED")
}

func TestSettingsPatchRejectsProxyEnableWithoutRuntimeConfig(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"proxyEnabled":true}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_SETTINGS")
}

func TestSettingsPatchUpdatesPlaybackSpeed(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"playbackSpeed":"Speed 2x"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"playbackSpeed":"Speed 2x"`) {
		t.Fatalf("expected updated playback speed, got %s", rec.Body.String())
	}
}

func TestSettingsPatchRejectsInvalidPlaybackSpeed(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"playbackSpeed":"Speed 9x"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_SETTINGS")
}

func TestSettingsPatchRejectsInvalidJSON(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_JSON")
}

func TestSettingsPatchReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"playbackSpeed":"Speed 2x"}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "SETTINGS_UPDATE_FAILED")
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
	if got := exportRec.Header().Get("Content-Disposition"); !strings.Contains(got, `attachment; filename="mpod-subscriptions.opml"`) {
		t.Fatalf("expected attachment disposition, got %q", got)
	}
}

func TestExportOPMLReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/export-opml", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "OPML_EXPORT_FAILED")
}

func TestPodcastEpisodesListReturnsEmptyArrayWhenNoEpisodes(t *testing.T) {
	handler, db := newTestRouter(t)
	cookie := register(t, handler, "admin", "secret")
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast One', 'https://example.com/feed.xml')`)

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1/episodes", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"episodes":[]`) {
		t.Fatalf("expected empty episodes array, got %s", rec.Body.String())
	}
}

func TestPodcastEpisodesListReturnsServerErrorWhenLoadFails(t *testing.T) {
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, nil)
	cookie := register(t, handler, "admin", "secret")
	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodGet, "/api/podcasts/1/episodes", nil)
	req.SetPathValue("id", "1")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "EPISODE_LIST_FAILED")
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

func TestImportOPMLRejectsInvalidDocument(t *testing.T) {
	handler, cookie := newAuthedRouter(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := fileWriter.Write([]byte("not-opml")); err != nil {
		t.Fatalf("Write failed: %v", err)
	}
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
	assertErrorCode(t, rec.Body.Bytes(), "INVALID_OPML")
}

func TestImportOPMLAllowsFileAtSizeLimit(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Podcast One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, _ := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")
	payload := opmlPayloadOfSize(t, maxOPMLFileBytes)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := fileWriter.Write(payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 for file at limit, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"imported":1`) || !strings.Contains(rec.Body.String(), `"skipped":0`) {
		t.Fatalf("unexpected OPML import payload at limit: %s", rec.Body.String())
	}
}

func TestImportOPMLRejectsFileAboveSizeLimit(t *testing.T) {
	handler, cookie := newAuthedRouter(t)
	payload := opmlPayloadOfSize(t, maxOPMLFileBytes+1)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := fileWriter.Write(payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), "OPML_TOO_LARGE")
}

func TestImportOPMLImportsFeeds(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		switch req.URL.Path {
		case "/feed-one.xml":
			return routerXMLResponse(testRouterRSSFeed("Podcast One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
		case "/feed-two.xml":
			return routerXMLResponse(testRouterRSSFeed("Podcast Two", "Episode Two", "guid-2", "https://cdn.example.com/2.mp3")), nil
		default:
			t.Fatalf("unexpected request path %q", req.URL.Path)
			return nil, nil
		}
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	opml := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Podcast One" xmlUrl="https://example.com/feed-one.xml"/>
    <outline text="Group">
      <outline text="Podcast Two" xmlUrl="https://example.com/feed-two.xml"/>
    </outline>
  </body>
</opml>`
	if _, err := fileWriter.Write([]byte(opml)); err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"imported":2`) || !strings.Contains(rec.Body.String(), `"skipped":0`) {
		t.Fatalf("unexpected OPML import payload: %s", rec.Body.String())
	}
	assertTableCount(t, db, `SELECT COUNT(*) FROM podcasts`, 2)
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 2)
}

func TestImportOPMLIsIdempotentForAlreadySubscribedFeeds(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Podcast One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	handler, db := newTestRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, client)
	cookie := register(t, handler, "admin", "secret")

	makeImportReq := func() *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
		if err != nil {
			t.Fatalf("CreateFormFile failed: %v", err)
		}
		if _, err := io.WriteString(fileWriter, `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Podcast One" xmlUrl="https://example.com/feed-one.xml"/>
  </body>
</opml>`); err != nil {
			t.Fatalf("write opml failed: %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("Close multipart writer failed: %v", err)
		}

		req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	firstRec := makeImportReq()
	if firstRec.Code != nethttp.StatusOK {
		t.Fatalf("expected first import to succeed, got %d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if !strings.Contains(firstRec.Body.String(), `"imported":1`) || !strings.Contains(firstRec.Body.String(), `"skipped":0`) {
		t.Fatalf("unexpected first import payload: %s", firstRec.Body.String())
	}

	secondRec := makeImportReq()
	if secondRec.Code != nethttp.StatusOK {
		t.Fatalf("expected second import to succeed, got %d body=%s", secondRec.Code, secondRec.Body.String())
	}
	if !strings.Contains(secondRec.Body.String(), `"imported":0`) || !strings.Contains(secondRec.Body.String(), `"skipped":1`) {
		t.Fatalf("unexpected second import payload: %s", secondRec.Body.String())
	}

	assertTableCount(t, db, `SELECT COUNT(*) FROM podcasts`, 1)
	assertTableCount(t, db, `SELECT COUNT(*) FROM episodes`, 1)
}

func TestImportOPMLReturnsStableInternalErrorContractOnUnexpectedFailure(t *testing.T) {
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		return routerXMLResponse(testRouterRSSFeed("Podcast One", "Episode One", "guid-1", "https://cdn.example.com/1.mp3")), nil
	})
	authDB := newTestDB(t)
	appDB := newTestDB(t)
	handler := newSplitRouterWithClient(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	}, authDB, appDB, client)
	cookie := register(t, handler, "admin", "secret")

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileWriter, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	if _, err := io.WriteString(fileWriter, `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Podcast One" xmlUrl="https://example.com/feed-one.xml"/>
  </body>
</opml>`); err != nil {
		t.Fatalf("write opml failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close multipart writer failed: %v", err)
	}

	if err := appDB.Close(); err != nil {
		t.Fatalf("appDB.Close failed: %v", err)
	}

	req := httptest.NewRequest(nethttp.MethodPost, "/api/podcasts/import-opml", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusInternalServerError, "OPML_IMPORT_FAILED")
}

func newAuthedRouter(t *testing.T) (nethttp.Handler, *nethttp.Cookie) {
	t.Helper()

	handler, _ := newTestRouter(t)
	return handler, register(t, handler, "admin", "secret")
}

func newTestRouter(t *testing.T) (nethttp.Handler, *storage.DB) {
	t.Helper()

	return newTestRouterWithConfig(t, config.Config{
		Environment:  "development",
		DownloadsDir: t.TempDir(),
	})
}

func newTestRouterWithConfig(t *testing.T, cfg config.Config) (nethttp.Handler, *storage.DB) {
	t.Helper()

	return newTestRouterWithClient(t, cfg, nil)
}

func newTestRouterWithClient(t *testing.T, cfg config.Config, client *nethttp.Client) (nethttp.Handler, *storage.DB) {
	t.Helper()

	db := newTestDB(t)
	return newSplitRouterWithClient(t, cfg, db, db, client), db
}

func newSplitRouterWithClient(t *testing.T, cfg config.Config, authDB, appDB *storage.DB, client *nethttp.Client) nethttp.Handler {
	t.Helper()

	if client == nil {
		client = newRouterDefaultClient(t, cfg, appDB)
	}

	settingsService := settings.NewServiceWithProxyStatusLookup(appDB.SQL, cfg.SOCKS5Host != "", cfg.AppBuild, func(ctx context.Context) (settings.ProxyLookupResult, error) {
		return fetchObservedProxyStatus(ctx, client)
	})
	playlistService := playlist.NewService(appDB.SQL)
	downloadsService := downloads.NewService(appDB.SQL, client, cfg.DownloadsDir)
	playlistActions := playlist.NewActions(appDB.SQL, downloadsService)
	podcastsService := podcasts.NewService(appDB.SQL, client)
	schedulerService, err := scheduler.NewService(
		appDB.SQL,
		log.New(io.Discard, "", 0),
		settingsService,
		podcastsService.RefreshAll,
		cfg.TZ,
	)
	if err != nil {
		t.Fatalf("scheduler.NewService failed: %v", err)
	}

	r := &Router{
		logger:          log.New(io.Discard, "", 0),
		config:          cfg,
		db:              appDB.SQL,
		auth:            auth.NewService(authDB.SQL),
		episodes:        episodes.NewService(appDB.SQL),
		episodeActions:  episodes.NewActions(appDB.SQL, downloadsService),
		playback:        playback.NewService(appDB.SQL, episodes.NewActions(appDB.SQL, downloadsService), playlistService),
		playlist:        playlistService,
		playlistActions: playlistActions,
		downloads:       downloadsService,
		podcasts:        podcastsService,
		remoteClient:    client,
		audioClient:     client,
		settings:        settingsService,
		scheduler:       schedulerService,
	}

	mux := nethttp.NewServeMux()
	mux.HandleFunc("GET /api/health", r.handleHealth)
	mux.HandleFunc("GET /api/auth/session", r.handleSession)
	mux.HandleFunc("POST /api/auth/register", r.handleRegister)
	mux.HandleFunc("POST /api/auth/login", r.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", r.handleLogout)
	mux.HandleFunc("GET /api/podcasts", r.handlePodcastsList)
	mux.HandleFunc("POST /api/podcasts", r.handlePodcastsCreate)
	mux.HandleFunc("GET /api/podcasts/{id}", r.handlePodcastGet)
	mux.HandleFunc("GET /api/podcasts/{id}/image", r.handlePodcastImage)
	mux.HandleFunc("DELETE /api/podcasts/{id}", r.handlePodcastDelete)
	mux.HandleFunc("POST /api/podcasts/{id}/refresh", r.handlePodcastRefresh)
	mux.HandleFunc("POST /api/podcasts/{id}/mark-all-listened", r.handlePodcastMarkAllListened)
	mux.HandleFunc("GET /api/podcasts/{id}/episodes", r.handlePodcastEpisodesList)
	mux.HandleFunc("POST /api/podcasts/import-opml", r.handlePodcastsImportOPML)
	mux.HandleFunc("GET /api/podcasts/export-opml", r.handlePodcastsExportOPML)
	mux.HandleFunc("POST /api/podcasts/refresh-all", r.handlePodcastsRefreshAll)
	mux.HandleFunc("GET /api/jobs/status", r.handleJobsStatus)
	mux.HandleFunc("GET /api/playback/queue", r.handlePlaybackQueue)
	mux.HandleFunc("PUT /api/playback/active", r.handlePlaybackActivePut)
	mux.HandleFunc("GET /api/playback/{episodeId}", r.handlePlaybackGet)
	mux.HandleFunc("POST /api/playback", r.handlePlaybackPost)
	mux.HandleFunc("GET /api/playlist", r.handlePlaylistList)
	mux.HandleFunc("POST /api/playlist", r.handlePlaylistAdd)
	mux.HandleFunc("DELETE /api/playlist/{episodeId}", r.handlePlaylistRemove)
	mux.HandleFunc("PATCH /api/playlist/reorder", r.handlePlaylistReorder)
	mux.HandleFunc("GET /api/episodes", r.handleEpisodesList)
	mux.HandleFunc("GET /api/episodes/{id}", r.handleEpisodeGet)
	mux.HandleFunc("PATCH /api/episodes/{id}", r.handleEpisodePatch)
	mux.HandleFunc("POST /api/episodes/{id}/download", r.handleEpisodeDownload)
	mux.HandleFunc("DELETE /api/episodes/{id}/download", r.handleEpisodeDownloadDelete)
	mux.HandleFunc("GET /api/episodes/{id}/audio", r.handleEpisodeAudio)
	mux.HandleFunc("GET /api/settings", r.handleSettingsGet)
	mux.HandleFunc("PATCH /api/settings", r.handleSettingsPatch)
	mux.HandleFunc("GET /api/proxy/status", r.handleProxyStatus)
	return r.recoverAndLog(mux)
}

func newRouterDefaultClient(t *testing.T, cfg config.Config, appDB *storage.DB) *nethttp.Client {
	t.Helper()

	settingsService := settings.NewService(appDB.SQL, cfg.SOCKS5Host != "", cfg.AppBuild)
	client, err := remote.NewHTTPClientWithProxyDecider(cfg, func(ctx context.Context) bool {
		enabled, err := settingsService.ProxyEnabled(ctx)
		return err == nil && enabled
	})
	if err != nil {
		t.Fatalf("create router default client failed: %v", err)
	}
	return client
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

func assertAPIError(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("expected %d, got %d body=%s", wantStatus, rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.Bytes(), wantCode)
}

func register(t *testing.T, handler nethttp.Handler, username, password string) *nethttp.Cookie {
	t.Helper()

	req := httptest.NewRequest(nethttp.MethodPost, "/api/auth/register", bytes.NewReader([]byte(`{"username":"`+username+`","password":"`+password+`"}`)))
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

func enableProxyForTest(t *testing.T, handler nethttp.Handler, cookie *nethttp.Cookie) {
	t.Helper()

	req := httptest.NewRequest(nethttp.MethodPatch, "/api/settings", bytes.NewReader([]byte(`{"proxyEnabled":true}`)))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200 from proxy enable patch, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func seedEpisode(t *testing.T, db *storage.DB, episodeID, podcastID int64) {
	t.Helper()
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`,
		podcastID,
		"Podcast "+strconv.FormatInt(podcastID, 10),
		"https://example.com/seed-"+strconv.FormatInt(podcastID, 10)+".xml",
	)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (?, ?, ?, ?, ?)`,
		episodeID, podcastID, "ep-seed-"+strconv.FormatInt(episodeID, 10), "Episode", "https://cdn.example.com/audio.mp3")
}

func seedEpisodeWithAudioURL(t *testing.T, db *storage.DB, episodeID, podcastID int64, audioURL string) {
	t.Helper()
	mustExecHTTP(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`,
		podcastID,
		"Podcast "+strconv.FormatInt(podcastID, 10),
		"https://example.com/seed-"+strconv.FormatInt(podcastID, 10)+".xml",
	)
	mustExecHTTP(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (?, ?, ?, ?, ?)`,
		episodeID, podcastID, "ep-seed-"+strconv.FormatInt(episodeID, 10), "Episode", audioURL)
}

func mustExecHTTP(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func assertTableCount(t *testing.T, db *storage.DB, query string, want int) {
	t.Helper()

	var got int
	if err := db.SQL.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	if got != want {
		t.Fatalf("expected count %d, got %d for query %q", want, got, query)
	}
}

func waitForTableCount(t *testing.T, db *storage.DB, query string, want int) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	var got int
	for time.Now().Before(deadline) {
		if err := db.SQL.QueryRow(query).Scan(&got); err != nil {
			t.Fatalf("count query failed: %v", err)
		}
		if got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected count %d, got %d for query %q", want, got, query)
}

func opmlPayloadOfSize(t *testing.T, size int) []byte {
	t.Helper()

	prefix := []byte(`<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body><outline text="Podcast" xmlUrl="https://example.com/feed.xml"/><!--`)
	suffix := []byte(`--></body></opml>`)
	if size < len(prefix)+len(suffix) {
		t.Fatalf("requested OPML payload size %d is too small", size)
	}

	payload := make([]byte, 0, size)
	payload = append(payload, prefix...)
	payload = append(payload, bytes.Repeat([]byte("x"), size-len(prefix)-len(suffix))...)
	payload = append(payload, suffix...)
	return payload
}

func testRouterRSSFeed(title, episodeTitle, guid, audioURL string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>` + title + `</title>
    <item>
      <title>` + episodeTitle + `</title>
      <guid>` + guid + `</guid>
      <enclosure url="` + audioURL + `" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`
}

func testRouterRSSFeedWithTwoEpisodes(title, firstTitle, firstGUID, firstAudioURL, secondTitle, secondGUID, secondAudioURL string) string {
	var builder strings.Builder
	builder.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>`)
	builder.WriteString(title)
	builder.WriteString(`</title>
    <item>
      <title>`)
	builder.WriteString(firstTitle)
	builder.WriteString(`</title>
      <guid>`)
	builder.WriteString(firstGUID)
	builder.WriteString(`</guid>
      <enclosure url="`)
	builder.WriteString(firstAudioURL)
	builder.WriteString(`" type="audio/mpeg"/>
    </item>
    <item>
      <title>`)
	builder.WriteString(secondTitle)
	builder.WriteString(`</title>
      <guid>`)
	builder.WriteString(secondGUID)
	builder.WriteString(`</guid>
      <enclosure url="`)
	builder.WriteString(secondAudioURL)
	builder.WriteString(`" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`)
	return builder.String()
}

type proxySelectionRecorder struct {
	direct []string
	proxy  []string
}

func (r *proxySelectionRecorder) reset() {
	r.direct = nil
	r.proxy = nil
}

func (r *proxySelectionRecorder) assertOnlyDirect(t *testing.T, wantURL string) {
	t.Helper()
	if len(r.proxy) != 0 {
		t.Fatalf("expected no proxy requests, got %v", r.proxy)
	}
	if len(r.direct) != 1 || r.direct[0] != wantURL {
		t.Fatalf("expected one direct request to %q, got %v", wantURL, r.direct)
	}
}

func (r *proxySelectionRecorder) assertOnlyProxy(t *testing.T, wantURL string) {
	t.Helper()
	if len(r.direct) != 0 {
		t.Fatalf("expected no direct requests, got %v", r.direct)
	}
	if len(r.proxy) != 1 || r.proxy[0] != wantURL {
		t.Fatalf("expected one proxy request to %q, got %v", wantURL, r.proxy)
	}
}

func newProxyAwareRouterHarness(t *testing.T, cfg config.Config) (nethttp.Handler, *storage.DB, *proxySelectionRecorder) {
	t.Helper()

	db := newTestDB(t)
	recorder := &proxySelectionRecorder{}
	settingsService := settings.NewService(db.SQL, cfg.SOCKS5Host != "", cfg.AppBuild)
	client := newRouterTestClient(func(req *nethttp.Request) (*nethttp.Response, error) {
		enabled, err := settingsService.ProxyEnabled(req.Context())
		if err != nil {
			t.Fatalf("ProxyEnabled failed: %v", err)
		}
		if enabled {
			recorder.proxy = append(recorder.proxy, req.URL.String())
		} else {
			recorder.direct = append(recorder.direct, req.URL.String())
		}
		return proxyAwareRouterResponse(t, req.URL.String()), nil
	})

	return newSplitRouterWithClient(t, cfg, db, db, client), db, recorder
}

func proxyAwareRouterResponse(t *testing.T, rawURL string) *nethttp.Response {
	t.Helper()

	switch rawURL {
	case "https://example.com/feed-one.xml":
		return routerXMLResponse(testRouterRSSFeed("Podcast One", "Episode One", "guid-1", "https://cdn.example.com/one.mp3"))
	case "https://example.com/feed-two.xml":
		return routerXMLResponse(testRouterRSSFeed("Podcast Two", "Episode Two", "guid-2", "https://cdn.example.com/two.mp3"))
	case "https://cdn.example.com/download.mp3":
		return routerBinaryResponse("audio/mpeg", []byte("download-audio"))
	case "https://cdn.example.com/audio.mp3":
		return routerBinaryResponse("audio/mpeg", []byte("stream-audio"))
	case "https://ipwho.is/":
		return routerJSONResponse(`{"success":true,"ip":"198.51.100.10","country":"Germany"}`)
	default:
		t.Fatalf("unexpected outbound request URL: %s", rawURL)
		return nil
	}
}

func newRouterTestClient(fn func(*nethttp.Request) (*nethttp.Response, error)) *nethttp.Client {
	return &nethttp.Client{
		Transport: routerRoundTripperFunc(fn),
	}
}

type routerRoundTripperFunc func(*nethttp.Request) (*nethttp.Response, error)

func (fn routerRoundTripperFunc) RoundTrip(req *nethttp.Request) (*nethttp.Response, error) {
	return fn(req)
}

func routerXMLResponse(body string) *nethttp.Response {
	resp := &nethttp.Response{
		StatusCode: nethttp.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(nethttp.Header),
	}
	resp.Header.Set("Content-Type", "application/rss+xml")
	return resp
}

func routerJSONResponse(body string) *nethttp.Response {
	resp := &nethttp.Response{
		StatusCode: nethttp.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(nethttp.Header),
	}
	resp.Header.Set("Content-Type", "application/json")
	return resp
}

func routerBinaryResponse(contentType string, body []byte) *nethttp.Response {
	resp := &nethttp.Response{
		StatusCode: nethttp.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     make(nethttp.Header),
	}
	resp.Header.Set("Content-Type", contentType)
	return resp
}
