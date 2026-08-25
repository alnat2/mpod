package audiobooks

import "time"

type ScannedTrack struct {
	TrackNumber int    `json:"trackNumber"`
	Title       string `json:"title"`
	RelPath     string `json:"relPath"`
	FilePath    string `json:"filePath"`
	Duration    int64  `json:"duration"`
}

type ScannedBook struct {
	Title     string         `json:"title"`
	Author    string         `json:"author"`
	RelPath   string         `json:"relPath"`
	CoverPath string         `json:"coverPath"`
	Tracks    []ScannedTrack `json:"tracks"`
}

type Track struct {
	ID              int64      `json:"id"`
	AudiobookID     int64      `json:"audiobookId"`
	TrackNumber     int        `json:"trackNumber"`
	Title           string     `json:"title"`
	RelPath         string     `json:"relPath"`
	FilePath        string     `json:"filePath"`
	Duration        int64      `json:"duration"`
	IsListened      bool       `json:"isListened"`
	PositionSeconds int64      `json:"positionSeconds"`
	LastUpdated     *time.Time `json:"lastUpdated,omitempty"`
}

type Audiobook struct {
	ID              int64     `json:"id"`
	Title           string    `json:"title"`
	Author          string    `json:"author"`
	RelPath         string    `json:"relPath"`
	CoverPath       string    `json:"coverPath,omitempty"`
	HasCover        bool      `json:"hasCover"`
	TotalDuration   int64     `json:"totalDuration"`
	TrackCount      int       `json:"trackCount"`
	ListenedCount   int       `json:"listenedCount"`
	IsListened      bool      `json:"isListened"`
	PositionSeconds int64     `json:"positionSeconds"`
	ActiveTrackID   *int64    `json:"activeTrackId,omitempty"`
	Tracks          []Track   `json:"tracks,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
