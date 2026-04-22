package storage

import (
	"database/sql"
	"errors"
	"log"
	"os"
)

func ReconcileDownloads(db *sql.DB, logger *log.Logger) error {
	rows, err := db.Query(`SELECT id, downloaded_path FROM episodes WHERE downloaded_path IS NOT NULL AND downloaded_path <> ''`)
	if err != nil {
		if isTableMissing(err) {
			return nil
		}
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var path string
		if err := rows.Scan(&id, &path); err != nil {
			return err
		}

		if _, err := os.Stat(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				if _, clearErr := db.Exec(`UPDATE episodes SET downloaded_path = NULL WHERE id = ?`, id); clearErr != nil {
					return clearErr
				}
				logger.Printf("reconciled missing download for episode %d: %s", id, path)
				continue
			}
			return err
		}
	}

	return rows.Err()
}

func isTableMissing(err error) bool {
	if err == nil {
		return false
	}
	return contains(err.Error(), "no such table: episodes")
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && stringIndex(s, sub) >= 0)
}

func stringIndex(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
