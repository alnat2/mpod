package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const SessionCookieName = "mpod_session"

var (
	ErrSetupDisabled       = errors.New("registration is disabled after initial setup")
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrInvalidRegistration = errors.New("invalid registration input")
)

type Service struct {
	db         *sql.DB
	sessionTTL time.Duration
	now        func() time.Time
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

func NewService(db *sql.DB) *Service {
	return &Service{
		db:         db,
		sessionTTL: 30 * 24 * time.Hour,
		now:        time.Now,
	}
}

func (s *Service) UserCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func (s *Service) RegisterInitial(ctx context.Context, username, password, confirmPassword string) (User, string, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" || confirmPassword == "" || password != confirmPassword {
		return User{}, "", ErrInvalidRegistration
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, "", fmt.Errorf("begin registration tx: %w", err)
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return User{}, "", fmt.Errorf("count users: %w", err)
	}
	if count > 0 {
		return User{}, "", ErrSetupDisabled
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, "", fmt.Errorf("hash password: %w", err)
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO users (username, password_hash)
		VALUES (?, ?)
	`, username, string(hash))
	if err != nil {
		return User{}, "", fmt.Errorf("create user: %w", err)
	}

	userID, err := result.LastInsertId()
	if err != nil {
		return User{}, "", fmt.Errorf("load new user id: %w", err)
	}

	sessionID, expiresAt, err := newSessionID(s.now(), s.sessionTTL)
	if err != nil {
		return User{}, "", err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, expires_at)
		VALUES (?, ?, ?)
	`, sessionID, userID, expiresAt.UTC()); err != nil {
		return User{}, "", fmt.Errorf("create session: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return User{}, "", fmt.Errorf("commit registration: %w", err)
	}

	return User{ID: userID, Username: username}, sessionID, nil
}

func (s *Service) Login(ctx context.Context, username, password string) (User, string, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return User{}, "", ErrInvalidCredentials
	}

	var user User
	var passwordHash string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, username, password_hash
		FROM users
		WHERE username = ?
	`, username).Scan(&user.ID, &user.Username, &passwordHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, "", ErrInvalidCredentials
		}
		return User{}, "", fmt.Errorf("load user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return User{}, "", ErrInvalidCredentials
	}

	sessionID, expiresAt, err := newSessionID(s.now(), s.sessionTTL)
	if err != nil {
		return User{}, "", err
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, expires_at)
		VALUES (?, ?, ?)
	`, sessionID, user.ID, expiresAt.UTC()); err != nil {
		return User{}, "", fmt.Errorf("create session: %w", err)
	}

	return user, sessionID, nil
}

func (s *Service) Logout(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, sessionID); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func (s *Service) CurrentUser(ctx context.Context, sessionID string) (*User, error) {
	if sessionID == "" {
		return nil, nil
	}

	var user User
	var expiresAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT users.id, users.username, sessions.expires_at
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.id = ?
	`, sessionID).Scan(&user.ID, &user.Username, &expiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load current user: %w", err)
	}

	if expiresAt.Before(s.now().UTC()) {
		if err := s.Logout(ctx, sessionID); err != nil {
			return nil, err
		}
		return nil, nil
	}

	return &user, nil
}

func newSessionID(now time.Time, ttl time.Duration) (string, time.Time, error) {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", time.Time{}, fmt.Errorf("generate session token: %w", err)
	}

	return hex.EncodeToString(token), now.Add(ttl), nil
}
