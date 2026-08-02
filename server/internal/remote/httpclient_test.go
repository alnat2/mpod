package remote

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/cross/mpod/server/internal/config"
)

func TestNewHTTPClientUsesDefaultTimeout(t *testing.T) {
	client, err := NewHTTPClient(config.Config{})
	if err != nil {
		t.Fatalf("NewHTTPClient failed: %v", err)
	}
	if client.Timeout != defaultClientTimeout {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := policyTransportNext(t, client).(*http.Transport); !ok {
		t.Fatalf("expected policy-wrapped *http.Transport, got %T", policyTransportNext(t, client))
	}
}

func TestCredentialsUsesOptionalAuth(t *testing.T) {
	if auth := credentials(config.Config{}); auth != nil {
		t.Fatalf("expected nil credentials when username is empty")
	}

	auth := credentials(config.Config{
		SOCKS5Username: "user",
		SOCKS5Password: "pass",
	})
	if auth == nil || auth.User != "user" || auth.Password != "pass" {
		t.Fatalf("unexpected credentials: %+v", auth)
	}
}

func TestNewHTTPClientWithProxyConfiguredBuildsProxyTransport(t *testing.T) {
	client, err := NewHTTPClient(config.Config{
		SOCKS5Host: "127.0.0.1",
		SOCKS5Port: "1080",
	})
	if err != nil {
		t.Fatalf("NewHTTPClient failed: %v", err)
	}
	if client.Timeout != defaultClientTimeout {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := policyTransportNext(t, client).(*http.Transport); !ok {
		t.Fatalf("expected proxy client to use policy-wrapped *http.Transport, got %T", policyTransportNext(t, client))
	}
}

func TestNewHTTPClientWithProxyDeciderWrapsTransportSelection(t *testing.T) {
	client, err := NewHTTPClientWithProxyDecider(config.Config{
		SOCKS5Host: "127.0.0.1",
		SOCKS5Port: "1080",
	}, func(_ context.Context) bool {
		return true
	})
	if err != nil {
		t.Fatalf("NewHTTPClientWithProxyDecider failed: %v", err)
	}
	if client.Timeout != defaultClientTimeout {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := policyTransportNext(t, client).(roundTripperFunc); !ok {
		t.Fatalf("expected policy to wrap transport selection, got %T", policyTransportNext(t, client))
	}
}

func TestNewHTTPClientWithProxyDeciderWithoutProxyConfigUsesDirectTransport(t *testing.T) {
	client, err := NewHTTPClientWithProxyDecider(config.Config{}, func(_ context.Context) bool {
		return true
	})
	if err != nil {
		t.Fatalf("NewHTTPClientWithProxyDecider failed: %v", err)
	}
	if client.Timeout != defaultClientTimeout {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := policyTransportNext(t, client).(*http.Transport); !ok {
		t.Fatalf("expected policy-wrapped direct transport without proxy config, got %T", policyTransportNext(t, client))
	}
}

func TestNewStreamingHTTPClientWithProxyDeciderDisablesClientTimeout(t *testing.T) {
	client, err := NewStreamingHTTPClientWithProxyDecider(config.Config{
		SOCKS5Host: "127.0.0.1",
		SOCKS5Port: "1080",
	}, func(_ context.Context) bool {
		return true
	})
	if err != nil {
		t.Fatalf("NewStreamingHTTPClientWithProxyDecider failed: %v", err)
	}
	if client.Timeout != 0 {
		t.Fatalf("expected no client timeout, got %v", client.Timeout)
	}
	if _, ok := policyTransportNext(t, client).(roundTripperFunc); !ok {
		t.Fatalf("expected policy to wrap transport selection, got %T", policyTransportNext(t, client))
	}
}

func TestNewClientWithRoundTrippersUsesProxyWhenEnabled(t *testing.T) {
	directCalls := 0
	proxyCalls := 0
	client := newClientWithRoundTrippers(
		roundTripperFunc(func(*http.Request) (*http.Response, error) {
			directCalls++
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("direct")),
				Header:     make(http.Header),
			}, nil
		}),
		roundTripperFunc(func(*http.Request) (*http.Response, error) {
			proxyCalls++
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("proxy")),
				Header:     make(http.Header),
			}, nil
		}),
		func(_ context.Context) bool { return true },
		defaultClientTimeout,
	)

	resp, err := client.Get("https://example.com")
	if err != nil {
		t.Fatalf("client.Get failed: %v", err)
	}
	resp.Body.Close()

	if directCalls != 0 || proxyCalls != 1 {
		t.Fatalf("expected proxy path only, got direct=%d proxy=%d", directCalls, proxyCalls)
	}
}

func TestNewClientWithRoundTrippersUsesDirectWhenProxyDisabled(t *testing.T) {
	directCalls := 0
	proxyCalls := 0
	client := newClientWithRoundTrippers(
		roundTripperFunc(func(*http.Request) (*http.Response, error) {
			directCalls++
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("direct")),
				Header:     make(http.Header),
			}, nil
		}),
		roundTripperFunc(func(*http.Request) (*http.Response, error) {
			proxyCalls++
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("proxy")),
				Header:     make(http.Header),
			}, nil
		}),
		func(_ context.Context) bool { return false },
		defaultClientTimeout,
	)

	resp, err := client.Get("https://example.com")
	if err != nil {
		t.Fatalf("client.Get failed: %v", err)
	}
	resp.Body.Close()

	if directCalls != 1 || proxyCalls != 0 {
		t.Fatalf("expected direct path only, got direct=%d proxy=%d", directCalls, proxyCalls)
	}
}

func policyTransportNext(t *testing.T, client *http.Client) http.RoundTripper {
	t.Helper()
	transport, ok := client.Transport.(policyRoundTripper)
	if !ok {
		t.Fatalf("expected policyRoundTripper, got %T", client.Transport)
	}
	return transport.next
}
