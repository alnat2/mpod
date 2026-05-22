package remote

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/config"
)

func TestNewHTTPClientUsesDefaultTimeout(t *testing.T) {
	client, err := NewHTTPClient(config.Config{})
	if err != nil {
		t.Fatalf("NewHTTPClient failed: %v", err)
	}
	if client.Timeout != 30*time.Second {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := client.Transport.(*http.Transport); !ok {
		t.Fatalf("expected *http.Transport, got %T", client.Transport)
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
	if client.Timeout != 30*time.Second {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := client.Transport.(*http.Transport); !ok {
		t.Fatalf("expected proxy client to use *http.Transport, got %T", client.Transport)
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
	if client.Timeout != 30*time.Second {
		t.Fatalf("expected 30s timeout, got %v", client.Timeout)
	}
	if _, ok := client.Transport.(roundTripperFunc); !ok {
		t.Fatalf("expected decider client to wrap transport selection, got %T", client.Transport)
	}
}
