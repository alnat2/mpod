package httputil

import (
	"crypto/tls"
	"net/http/httptest"
	"testing"
)

func TestParseRFC7239Forwarded(t *testing.T) {
	tests := []struct {
		name      string
		header    string
		wantProto string
		wantHost  string
	}{
		{
			name:      "empty",
			header:    "",
			wantProto: "",
			wantHost:  "",
		},
		{
			name:      "standard single hop",
			header:    "proto=https;host=example.com",
			wantProto: "https",
			wantHost:  "example.com",
		},
		{
			name:      "quoted values",
			header:    `proto="https";host="example.com"`,
			wantProto: "https",
			wantHost:  "example.com",
		},
		{
			name:      "whitespace around delimiters and keys",
			header:    ` proto = "https" ;  host = example.com `,
			wantProto: "https",
			wantHost:  "example.com",
		},
		{
			name:      "multi-hop takes first hop",
			header:    `proto=https;host=client.example, proto=http;host=internal.proxy`,
			wantProto: "https",
			wantHost:  "client.example",
		},
		{
			name:      "host only",
			header:    "for=192.0.2.1;host=example.com",
			wantProto: "",
			wantHost:  "example.com",
		},
		{
			name:      "case-insensitivity of keys",
			header:    "PROTO=HTTPS;Host=Example.Com",
			wantProto: "HTTPS",
			wantHost:  "Example.Com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotProto, gotHost := ParseRFC7239Forwarded(tt.header)
			if gotProto != tt.wantProto {
				t.Errorf("ParseRFC7239Forwarded() proto = %q, want %q", gotProto, tt.wantProto)
			}
			if gotHost != tt.wantHost {
				t.Errorf("ParseRFC7239Forwarded() host = %q, want %q", gotHost, tt.wantHost)
			}
		})
	}
}

func TestRequestScheme(t *testing.T) {
	t.Run("nil request", func(t *testing.T) {
		if got := RequestScheme(nil); got != "http" {
			t.Fatalf("expected http, got %q", got)
		}
	})

	t.Run("direct tls", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.TLS = &tls.ConnectionState{}
		if got := RequestScheme(req); got != "https" {
			t.Fatalf("expected https, got %q", got)
		}
	})

	t.Run("forwarded proto https", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=https;host=example.com")
		if got := RequestScheme(req); got != "https" {
			t.Fatalf("expected https, got %q", got)
		}
	})

	t.Run("forwarded proto multi-hop", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=https;host=example.com, proto=http;host=internal")
		if got := RequestScheme(req); got != "https" {
			t.Fatalf("expected https, got %q", got)
		}
	})

	t.Run("forwarded non-https proto overrides x-forwarded-proto", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "proto=http;host=example.com")
		req.Header.Set("X-Forwarded-Proto", "https")
		if got := RequestScheme(req); got != "http" {
			t.Fatalf("expected http, got %q", got)
		}
	})

	t.Run("forwarded without proto falls back to x-forwarded-proto", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("Forwarded", "host=example.com")
		req.Header.Set("X-Forwarded-Proto", "https")
		if got := RequestScheme(req); got != "https" {
			t.Fatalf("expected https, got %q", got)
		}
	})

	t.Run("x-forwarded-proto https", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		if got := RequestScheme(req); got != "https" {
			t.Fatalf("expected https, got %q", got)
		}
	})

	t.Run("plain http fallback", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://example.com/", nil)
		if got := RequestScheme(req); got != "http" {
			t.Fatalf("expected http, got %q", got)
		}
	})
}

func TestRequestHost(t *testing.T) {
	t.Run("nil request", func(t *testing.T) {
		if got := RequestHost(nil); got != "" {
			t.Fatalf("expected empty string, got %q", got)
		}
	})

	t.Run("forwarded host single hop", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		req.Header.Set("Forwarded", `proto=https;host="mpod.example.com"`)
		if got := RequestHost(req); got != "mpod.example.com" {
			t.Fatalf("expected mpod.example.com, got %q", got)
		}
	})

	t.Run("forwarded host multi-hop", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		req.Header.Set("Forwarded", "host=client.example, host=internal.proxy")
		if got := RequestHost(req); got != "client.example" {
			t.Fatalf("expected client.example, got %q", got)
		}
	})

	t.Run("forwarded host takes priority over x-forwarded-host", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		req.Header.Set("Forwarded", "host=forwarded.example")
		req.Header.Set("X-Forwarded-Host", "xfh.example")
		if got := RequestHost(req); got != "forwarded.example" {
			t.Fatalf("expected forwarded.example, got %q", got)
		}
	})

	t.Run("x-forwarded-host single hop", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		req.Header.Set("X-Forwarded-Host", "mpod.example.com")
		if got := RequestHost(req); got != "mpod.example.com" {
			t.Fatalf("expected mpod.example.com, got %q", got)
		}
	})

	t.Run("x-forwarded-host multi-hop takes first", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		req.Header.Set("X-Forwarded-Host", "client.example, proxy.internal")
		if got := RequestHost(req); got != "client.example" {
			t.Fatalf("expected client.example, got %q", got)
		}
	})

	t.Run("falls back to req.Host", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080/", nil)
		req.Host = "127.0.0.1:8080"
		if got := RequestHost(req); got != "127.0.0.1:8080" {
			t.Fatalf("expected 127.0.0.1:8080, got %q", got)
		}
	})
}
