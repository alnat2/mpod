package auth

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/storage"
)

func TestRegisterInitialCreatesOnlyUserAndSession(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	service.now = func() time.Time { return time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC) }

	user, sessionID, err := service.RegisterInitial(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}
	if user.ID == 0 || user.Username != "admin" {
		t.Fatalf("unexpected user returned: %+v", user)
	}
	if sessionID == "" {
		t.Fatalf("expected non-empty session ID")
	}

	count, err := service.UserCount(context.Background())
	if err != nil {
		t.Fatalf("UserCount failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 user, got %d", count)
	}

	currentUser, err := service.CurrentUser(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("CurrentUser failed: %v", err)
	}
	if currentUser == nil || currentUser.Username != "admin" {
		t.Fatalf("expected current user admin, got %+v", currentUser)
	}
}

func TestRegisterInitialRejectsSecondRegistration(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	if _, _, err := service.RegisterInitial(context.Background(), "admin", "secret"); err != nil {
		t.Fatalf("first RegisterInitial failed: %v", err)
	}

	if _, _, err := service.RegisterInitial(context.Background(), "other", "secret"); err != ErrSetupDisabled {
		t.Fatalf("expected ErrSetupDisabled, got %v", err)
	}
}

func TestLoginValidAndInvalidPassword(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	if _, _, err := service.RegisterInitial(context.Background(), "admin", "secret"); err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}

	user, sessionID, err := service.Login(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("Login failed: %v", err)
	}
	if user.Username != "admin" || sessionID == "" {
		t.Fatalf("unexpected login result user=%+v sessionID=%q", user, sessionID)
	}

	if _, _, err := service.Login(context.Background(), "admin", "wrong"); err != ErrInvalidCredentials {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogoutDeletesSession(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	if _, sessionID, err := service.RegisterInitial(context.Background(), "admin", "secret"); err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	} else {
		if err := service.Logout(context.Background(), sessionID); err != nil {
			t.Fatalf("Logout failed: %v", err)
		}
	}

	currentUser, err := service.CurrentUser(context.Background(), "")
	if err != nil {
		t.Fatalf("CurrentUser empty session failed: %v", err)
	}
	if currentUser != nil {
		t.Fatalf("expected nil user for empty session, got %+v", currentUser)
	}
}

func TestCurrentUserRemovesExpiredSession(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	baseTime := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return baseTime }

	_, sessionID, err := service.RegisterInitial(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}

	service.now = func() time.Time { return baseTime.Add(31 * 24 * time.Hour) }
	currentUser, err := service.CurrentUser(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("CurrentUser failed: %v", err)
	}
	if currentUser != nil {
		t.Fatalf("expected nil user for expired session, got %+v", currentUser)
	}

	var sessionCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ?`, sessionID).Scan(&sessionCount); err != nil {
		t.Fatalf("query session count failed: %v", err)
	}
	if sessionCount != 0 {
		t.Fatalf("expected expired session to be deleted, count=%d", sessionCount)
	}
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
