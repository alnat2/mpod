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

func TestCurrentUserRemovesSessionAtExactExpiry(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	baseTime := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return baseTime }

	_, sessionID, err := service.RegisterInitial(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}

	service.now = func() time.Time { return baseTime.Add(service.sessionTTL) }
	currentUser, err := service.CurrentUser(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("CurrentUser failed: %v", err)
	}
	if currentUser != nil {
		t.Fatalf("expected nil user at exact session expiry, got %+v", currentUser)
	}
}

func TestCleanupExpiredSessionsDeletesOnlyExpiredRows(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	now := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	_, activeSessionID, err := service.RegisterInitial(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}
	if _, err := db.SQL.Exec(`
		INSERT INTO sessions (id, user_id, expires_at)
		VALUES ('expired-before', 1, ?), ('expired-at', 1, ?)
	`, now.Add(-time.Second), now); err != nil {
		t.Fatalf("insert expired sessions: %v", err)
	}

	deleted, err := service.CleanupExpiredSessions(context.Background())
	if err != nil {
		t.Fatalf("CleanupExpiredSessions failed: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("expected 2 deleted sessions, got %d", deleted)
	}

	var remainingIDs string
	if err := db.SQL.QueryRow(`SELECT GROUP_CONCAT(id, ',') FROM sessions`).Scan(&remainingIDs); err != nil {
		t.Fatalf("query remaining sessions: %v", err)
	}
	if remainingIDs != activeSessionID {
		t.Fatalf("expected only active session %q, got %q", activeSessionID, remainingIDs)
	}
}

func TestLoginCleansUpExpiredSessions(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	baseTime := time.Date(2026, 4, 22, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return baseTime }

	_, expiredSessionID, err := service.RegisterInitial(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("RegisterInitial failed: %v", err)
	}

	service.now = func() time.Time { return baseTime.Add(31 * 24 * time.Hour) }
	_, newSessionID, err := service.Login(context.Background(), "admin", "secret")
	if err != nil {
		t.Fatalf("Login failed: %v", err)
	}

	var expiredCount, newCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ?`, expiredSessionID).Scan(&expiredCount); err != nil {
		t.Fatalf("query expired session: %v", err)
	}
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = ?`, newSessionID).Scan(&newCount); err != nil {
		t.Fatalf("query new session: %v", err)
	}
	if expiredCount != 0 || newCount != 1 {
		t.Fatalf("expected expired session removed and new session retained, expired=%d new=%d", expiredCount, newCount)
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
