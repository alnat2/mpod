package http

import (
	"bytes"
	"strings"
	"testing"

	"github.com/cross/mpod/server/internal/config"
	nethttp "net/http"
	"net/http/httptest"
)

func TestSecurityHeadersAreAppliedToAppAndAPIResponses(t *testing.T) {
	handler, _ := newTestRouter(t)

	for _, path := range []string{"/api/health", "/"} {
		req := httptest.NewRequest(nethttp.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Fatalf("%s X-Content-Type-Options = %q, want nosniff", path, got)
		}
		if got := rec.Header().Get("Referrer-Policy"); got != "same-origin" {
			t.Fatalf("%s Referrer-Policy = %q, want same-origin", path, got)
		}
		policy := rec.Header().Get("Content-Security-Policy")
		for _, directive := range []string{"default-src 'self'", "frame-ancestors 'none'", "object-src 'none'"} {
			if !strings.Contains(policy, directive) {
				t.Fatalf("%s CSP %q does not contain %q", path, policy, directive)
			}
		}
	}
}

func TestStateChangingAPIRejectsForeignOrigin(t *testing.T) {
	handler, _ := newTestRouter(t)
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://mpod.test/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Header.Set("Origin", "https://attacker.example")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusForbidden, "CROSS_ORIGIN_REQUEST")
}

func TestStateChangingAPIAllowsMatchingOrigin(t *testing.T) {
	handler, _ := newTestRouter(t)
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://mpod.test/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Header.Set("Origin", "http://mpod.test")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIAllowsMatchingForwardedHTTPSOrigin(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://mpod.test/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Header.Set("Origin", "https://mpod.test")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIAllowsMatchingXForwardedHost(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("X-Forwarded-Host", "mpod.beloglazkin.work")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIAllowsMatchingXForwardedHostWithMultipleProxies(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("X-Forwarded-Host", "mpod.beloglazkin.work, 192.168.0.222")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIAllowsMatchingRFC7239ForwardedHeader(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("Forwarded", "proto=https;host=\"mpod.beloglazkin.work\"")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIAllowsMatchingForwardedDefaultPort(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("X-Forwarded-Host", "mpod.beloglazkin.work:443")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIRejectsMismatchedXForwardedHost(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://attacker.example")
	req.Header.Set("X-Forwarded-Host", "mpod.beloglazkin.work")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusForbidden, "CROSS_ORIGIN_REQUEST")
}

func TestStateChangingAPIRejectsMismatchedRFC7239ForwardedHost(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://attacker.example")
	req.Header.Set("Forwarded", "proto=https;host=\"mpod.beloglazkin.work\"")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	assertAPIError(t, rec, nethttp.StatusForbidden, "CROSS_ORIGIN_REQUEST")
}

func TestStateChangingAPIAllowsMatchingRFC7239ForwardedMultiHop(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("Forwarded", "proto=https;host=\"mpod.beloglazkin.work\", proto=http;host=\"internal-hop\"")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIPrioritizesRFC7239OverXForwardedHeaders(t *testing.T) {
	handler, _ := newTestRouterWithConfig(t, config.Config{
		Environment:  "production",
		DownloadsDir: t.TempDir(),
	})
	req := httptest.NewRequest(
		nethttp.MethodPost,
		"http://127.0.0.1:8080/api/auth/register",
		bytes.NewReader([]byte(`{"username":"admin","password":"secret"}`)),
	)
	req.Host = "127.0.0.1:8080"
	req.Header.Set("Origin", "https://mpod.beloglazkin.work")
	req.Header.Set("Forwarded", "proto=https;host=\"mpod.beloglazkin.work\"")
	req.Header.Set("X-Forwarded-Host", "other.example")
	req.Header.Set("X-Forwarded-Proto", "http")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != nethttp.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}
