package auth

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSetSessionCookieSignsSessionID(t *testing.T) {
	rec := httptest.NewRecorder()

	SetSessionCookie(rec, "session-123", "secret-key", true)

	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected session cookie to be set")
	}
	if cookies[0].Value == "session-123" {
		t.Fatalf("expected signed cookie value, got raw session ID %q", cookies[0].Value)
	}
	if !strings.HasPrefix(cookies[0].Value, "session-123.") {
		t.Fatalf("expected signed cookie to include session ID prefix, got %q", cookies[0].Value)
	}
}

func TestSessionIDFromRequestReturnsVerifiedSessionID(t *testing.T) {
	rec := httptest.NewRecorder()
	SetSessionCookie(rec, "session-123", "secret-key", false)

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(rec.Result().Cookies()[0])

	if got := SessionIDFromRequest(req, "secret-key"); got != "session-123" {
		t.Fatalf("expected verified session ID, got %q", got)
	}
}

func TestSessionIDFromRequestRejectsTamperedCookie(t *testing.T) {
	rec := httptest.NewRecorder()
	SetSessionCookie(rec, "session-123", "secret-key", false)

	cookie := rec.Result().Cookies()[0]
	cookie.Value = strings.Replace(cookie.Value, "session-123", "session-999", 1)

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(cookie)

	if got := SessionIDFromRequest(req, "secret-key"); got != "" {
		t.Fatalf("expected tampered cookie to be rejected, got %q", got)
	}
}

func TestSessionIDFromRequestRejectsUnsignedCookie(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{
		Name:  SessionCookieName,
		Value: "plain-session-id",
	})

	if got := SessionIDFromRequest(req, "secret-key"); got != "" {
		t.Fatalf("expected unsigned cookie to be rejected, got %q", got)
	}
}

func TestSessionCookieSecure(t *testing.T) {
	t.Run("nil request", func(t *testing.T) {
		if SessionCookieSecure(nil) {
			t.Fatal("expected false for nil request")
		}
	})

	t.Run("plain http", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		if SessionCookieSecure(req) {
			t.Fatal("expected false for plain http request")
		}
	})

	t.Run("direct tls", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.TLS = &tls.ConnectionState{}
		if !SessionCookieSecure(req) {
			t.Fatal("expected true for TLS request")
		}
	})

	t.Run("forwarded proto https", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=https;host=example.com")
		if !SessionCookieSecure(req) {
			t.Fatal("expected true for Forwarded proto=https")
		}
	})

	t.Run("forwarded proto multi-hop", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=https;host=example.com, proto=http;host=internal")
		if !SessionCookieSecure(req) {
			t.Fatal("expected true for multi-hop Forwarded with first hop https")
		}
	})

	t.Run("x-forwarded-proto https", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		if !SessionCookieSecure(req) {
			t.Fatal("expected true for X-Forwarded-Proto https")
		}
	})

	t.Run("forwarded priority over x-forwarded-proto", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=http;host=example.com")
		req.Header.Set("X-Forwarded-Proto", "https")
		if SessionCookieSecure(req) {
			t.Fatal("expected false when Forwarded proto=http overrides X-Forwarded-Proto https")
		}
	})
}
