package settings

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Service struct {
	db *sql.DB
}

type Values struct {
	DailyRefreshTime string `json:"dailyRefreshTime"`
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) Get(ctx context.Context) (Values, error) {
	var values Values
	if err := s.db.QueryRowContext(ctx, `
		SELECT value
		FROM settings
		WHERE key = 'daily_refresh_time'
	`).Scan(&values.DailyRefreshTime); err != nil {
		return Values{}, fmt.Errorf("load settings: %w", err)
	}
	return values, nil
}

func (s *Service) Update(ctx context.Context, dailyRefreshTime string) (Values, error) {
	if _, err := time.Parse("15:04", dailyRefreshTime); err != nil {
		return Values{}, fmt.Errorf("invalid daily refresh time: %w", err)
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE settings
		SET value = ?
		WHERE key = 'daily_refresh_time'
	`, dailyRefreshTime); err != nil {
		return Values{}, fmt.Errorf("update settings: %w", err)
	}

	return Values{DailyRefreshTime: dailyRefreshTime}, nil
}
