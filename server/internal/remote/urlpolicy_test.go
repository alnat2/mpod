package remote

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/cross/mpod/server/internal/config"
)

func TestValidateHTTPURLAllowsPublicAndPrivateHTTPHosts(t *testing.T) {
	targets := []string{
		"https://feeds.example.com/podcast.xml",
		"http://127.0.0.1:8080/feed.xml",
		"http://192.168.0.222/feed.xml",
		"http://[::1]/feed.xml",
	}

	for _, raw := range targets {
		t.Run(raw, func(t *testing.T) {
			target, err := url.Parse(raw)
			if err != nil {
				t.Fatalf("url.Parse failed: %v", err)
			}
			if err := ValidateHTTPURL(target); err != nil {
				t.Fatalf("expected URL to be allowed, got %v", err)
			}
		})
	}
}

func TestValidateHTTPURLRejectsUnsafeShapes(t *testing.T) {
	tests := []struct {
		name   string
		target *url.URL
	}{
		{name: "missing URL"},
		{name: "ftp scheme", target: &url.URL{Scheme: "ftp", Host: "example.com", Path: "/feed.xml"}},
		{name: "file scheme", target: &url.URL{Scheme: "file", Path: "/etc/passwd"}},
		{name: "missing host", target: &url.URL{Scheme: "https", Path: "/feed.xml"}},
		{name: "opaque URL", target: &url.URL{Scheme: "https", Opaque: "example.com/feed.xml"}},
		{name: "embedded username", target: &url.URL{Scheme: "https", Host: "example.com", User: url.User("user")}},
		{name: "embedded password", target: &url.URL{Scheme: "https", Host: "example.com", User: url.UserPassword("user", "secret")}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateHTTPURL(tt.target); !errors.Is(err, ErrOutboundURLNotAllowed) {
				t.Fatalf("expected ErrOutboundURLNotAllowed, got %v", err)
			}
		})
	}
}

func TestHTTPClientRejectsDisallowedInitialRequestBeforeTransport(t *testing.T) {
	transportCalls := 0
	client := newClientWithRoundTrippers(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		transportCalls++
		return okResponse(), nil
	}), nil, nil, defaultClientTimeout)

	_, err := client.Get("ftp://example.com/feed.xml")
	if !errors.Is(err, ErrOutboundURLNotAllowed) {
		t.Fatalf("expected ErrOutboundURLNotAllowed, got %v", err)
	}
	if transportCalls != 0 {
		t.Fatalf("expected blocked request not to reach transport, got %d calls", transportCalls)
	}
}

func TestHTTPClientRevalidatesRedirectTargets(t *testing.T) {
	for _, redirectTarget := range []string{
		"file:///etc/passwd",
		"https://user:secret@example.com/feed.xml",
	} {
		t.Run(redirectTarget, func(t *testing.T) {
			transportCalls := 0
			client := newClientWithRoundTrippers(roundTripperFunc(func(req *http.Request) (*http.Response, error) {
				transportCalls++
				return &http.Response{
					StatusCode: http.StatusFound,
					Status:     "302 Found",
					Header:     http.Header{"Location": []string{redirectTarget}},
					Body:       io.NopCloser(strings.NewReader("")),
					Request:    req,
				}, nil
			}), nil, nil, defaultClientTimeout)

			_, err := client.Get("https://example.com/feed.xml")
			if !errors.Is(err, ErrOutboundURLNotAllowed) {
				t.Fatalf("expected redirect target to be rejected, got %v", err)
			}
			if transportCalls != 1 {
				t.Fatalf("expected only initial request to reach transport, got %d calls", transportCalls)
			}
		})
	}
}

func TestHTTPClientAllowsPrivateNetworkTarget(t *testing.T) {
	transportCalls := 0
	client := newClientWithRoundTrippers(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		transportCalls++
		return okResponse(), nil
	}), nil, nil, defaultClientTimeout)

	resp, err := client.Get("http://192.168.0.222/feed.xml")
	if err != nil {
		t.Fatalf("expected private target to be allowed, got %v", err)
	}
	resp.Body.Close()
	if transportCalls != 1 {
		t.Fatalf("expected private request to reach transport once, got %d calls", transportCalls)
	}
}

func TestNewHTTPClientAppliesPolicyWithProxyConfiguration(t *testing.T) {
	client, err := NewHTTPClient(config.Config{
		SOCKS5Host: "127.0.0.1",
		SOCKS5Port: "1080",
	})
	if err != nil {
		t.Fatalf("NewHTTPClient failed: %v", err)
	}

	_, err = client.Get("https://user:secret@example.com/feed.xml")
	if !errors.Is(err, ErrOutboundURLNotAllowed) {
		t.Fatalf("expected credential URL to be rejected before proxy dial, got %v", err)
	}
}

func okResponse() *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader("ok")),
	}
}
