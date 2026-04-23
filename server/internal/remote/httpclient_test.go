package remote

import (
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
