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
		return err
	}

	type missingDownload struct {
		id   int64
		path string
	}
	var missing []missingDownload

	for rows.Next() {
		var id int64
		var path string
		if err := rows.Scan(&id, &path); err != nil {
			_ = rows.Close()
			return err
		}

		if _, err := os.Stat(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				missing = append(missing, missingDownload{id: id, path: path})
				continue
			}
			_ = rows.Close()
			return err
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	_ = rows.Close()

	for _, item := range missing {
		if _, clearErr := db.Exec(`UPDATE episodes SET downloaded_path = NULL WHERE id = ?`, item.id); clearErr != nil {
			return clearErr
		}
		logger.Printf("reconciled missing download for episode %d: %s", item.id, item.path)
	}

	return nil
}
