package scheduler

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/cross/mpod/server/internal/settings"
)

const jobName = "daily_refresh"

var ErrAlreadyRunning = errors.New("scheduler already running")

type RefreshAllFunc func(context.Context) error

type Service struct {
	db         *sql.DB
	logger     *log.Logger
	settings   *settings.Service
	refreshAll RefreshAllFunc
	mu         sync.Mutex
	running    bool
	lastDayKey string
}

type Status struct {
	State         string     `json:"state"`
	LastRunAt     *time.Time `json:"lastRunAt"`
	LastSuccessAt *time.Time `json:"lastSuccessAt"`
	LastFailureAt *time.Time `json:"lastFailureAt,omitempty"`
	LastError     *string    `json:"lastError,omitempty"`
}

func NewService(db *sql.DB, logger *log.Logger, settings *settings.Service, refreshAll RefreshAllFunc) *Service {
	return &Service{db: db, logger: logger, settings: settings, refreshAll: refreshAll}
}

func (s *Service) Start(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			s.maybeRun(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *Service) RunOnce(ctx context.Context) error {
	startedAt := time.Now().UTC()
	if err := s.setState(ctx, "running", &startedAt, nil, nil, nil); err != nil {
		return err
	}
	if err := s.refreshAll(ctx); err != nil {
		failedAt := time.Now().UTC()
		message := err.Error()
		if updateErr := s.setState(ctx, "failed", &startedAt, nil, &failedAt, &message); updateErr != nil {
			return updateErr
		}
		return err
	}
	succeededAt := time.Now().UTC()
	return s.setState(ctx, "completed", &startedAt, &succeededAt, nil, nil)
}

func (s *Service) RunNow(ctx context.Context) error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return ErrAlreadyRunning
	}
	s.running = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	return s.RunOnce(ctx)
}

func (s *Service) GetStatus(ctx context.Context) (Status, error) {
	var status Status
	var lastRun sql.NullTime
	var lastSuccess sql.NullTime
	var lastFailure sql.NullTime
	var lastError sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT state, last_run_at, last_success_at, last_failure_at, last_error
		FROM scheduler_state
		WHERE job_name = ?
	`, jobName).Scan(&status.State, &lastRun, &lastSuccess, &lastFailure, &lastError)
	if err != nil {
		if err == sql.ErrNoRows {
			return Status{State: "idle"}, nil
		}
		return Status{}, fmt.Errorf("load scheduler status: %w", err)
	}

	if lastRun.Valid {
		t := lastRun.Time.UTC()
		status.LastRunAt = &t
	}
	if lastSuccess.Valid {
		t := lastSuccess.Time.UTC()
		status.LastSuccessAt = &t
	}
	if lastFailure.Valid {
		t := lastFailure.Time.UTC()
		status.LastFailureAt = &t
	}
	if lastError.Valid && strings.TrimSpace(lastError.String) != "" {
		e := lastError.String
		status.LastError = &e
	}
	return status, nil
}

func (s *Service) maybeRun(ctx context.Context) {
	values, err := s.settings.Get(ctx)
	if err != nil {
		s.logger.Printf("scheduler settings load failed: %v", err)
		return
	}

	now := time.Now()
	hour, minute, err := parseClock(values.DailyRefreshTime)
	if err != nil {
		s.logger.Printf("scheduler invalid refresh time %q: %v", values.DailyRefreshTime, err)
		return
	}
	if now.Hour() != hour || now.Minute() != minute {
		return
	}

	dayKey := now.Format("2006-01-02")
	s.mu.Lock()
	if s.running || s.lastDayKey == dayKey {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.lastDayKey = dayKey
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
		}()
		if err := s.RunOnce(context.Background()); err != nil {
			s.logger.Printf("scheduler run failed: %v", err)
		}
	}()
}

func (s *Service) setState(ctx context.Context, state string, lastRunAt, lastSuccessAt, lastFailureAt *time.Time, lastError *string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO scheduler_state (job_name, state, last_run_at, last_success_at, last_failure_at, last_error)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (job_name) DO UPDATE SET
			state = excluded.state,
			last_run_at = excluded.last_run_at,
			last_success_at = COALESCE(excluded.last_success_at, scheduler_state.last_success_at),
			last_failure_at = excluded.last_failure_at,
			last_error = excluded.last_error
	`, jobName, state, lastRunAt, lastSuccessAt, lastFailureAt, lastError)
	if err != nil {
		return fmt.Errorf("save scheduler state: %w", err)
	}
	return nil
}

func parseClock(value string) (int, int, error) {
	t, err := time.Parse("15:04", value)
	if err != nil {
		return 0, 0, err
	}
	return t.Hour(), t.Minute(), nil
}
