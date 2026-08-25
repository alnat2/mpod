package audiobooks

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanDirectory(t *testing.T) {
	tempDir := t.TempDir()

	// 1. Root single file: 1984.m4b
	mustWriteFile(t, filepath.Join(tempDir, "1984.m4b"), "fake-audio")

	// 2. Root multi-track book: Мартин Иден
	martinDir := filepath.Join(tempDir, "Мартин Иден")
	mustMkdir(t, martinDir)
	mustWriteFile(t, filepath.Join(martinDir, "01_Глава 1.mp3"), "fake-audio")
	mustWriteFile(t, filepath.Join(martinDir, "10_Глава 10.mp3"), "fake-audio")
	mustWriteFile(t, filepath.Join(martinDir, "02_Глава 2.mp3"), "fake-audio")
	mustWriteFile(t, filepath.Join(martinDir, "cover.jpg"), "fake-cover")
	mustWriteFile(t, filepath.Join(martinDir, "notes.txt"), "fake-notes") // should be ignored

	// 3. Author folder: Пелевин
	pelevinDir := filepath.Join(tempDir, "Пелевин")
	mustMkdir(t, pelevinDir)

	// 3a. Standalone single file inside author folder
	mustWriteFile(t, filepath.Join(pelevinDir, "Generation_P.m4a"), "fake-audio")

	// 3b. Multi-track book inside author folder
	ananasDir := filepath.Join(pelevinDir, "Ананасная вода для прекрасной дамы")
	mustMkdir(t, ananasDir)
	mustWriteFile(t, filepath.Join(ananasDir, "01.mp3"), "fake-audio")
	mustWriteFile(t, filepath.Join(ananasDir, "02.mp3"), "fake-audio")
	mustWriteFile(t, filepath.Join(ananasDir, "folder.png"), "fake-cover")

	books, err := ScanDirectory(tempDir)
	if err != nil {
		t.Fatalf("ScanDirectory failed: %v", err)
	}

	if len(books) != 4 {
		t.Fatalf("expected 4 books, got %d", len(books))
	}

	// Verify books:
	bookMap := make(map[string]ScannedBook)
	for _, b := range books {
		bookMap[b.Title] = b
	}

	// 1984
	b1, ok := bookMap["1984"]
	if !ok {
		t.Errorf("book '1984' not found")
	} else {
		if b1.Author != "" {
			t.Errorf("expected empty author for root book, got %q", b1.Author)
		}
		if len(b1.Tracks) != 1 {
			t.Errorf("expected 1 track for 1984, got %d", len(b1.Tracks))
		}
	}

	// Мартин Иден
	b2, ok := bookMap["Мартин Иден"]
	if !ok {
		t.Errorf("book 'Мартин Иден' not found")
	} else {
		if len(b2.Tracks) != 3 {
			t.Errorf("expected 3 tracks for Мартин Иден, got %d", len(b2.Tracks))
		}
		// Verify natural sorting: 01, 02, 10
		if b2.Tracks[0].Title != "01_Глава 1" {
			t.Errorf("expected first track '01_Глава 1', got %q", b2.Tracks[0].Title)
		}
		if b2.Tracks[1].Title != "02_Глава 2" {
			t.Errorf("expected second track '02_Глава 2', got %q", b2.Tracks[1].Title)
		}
		if b2.Tracks[2].Title != "10_Глава 10" {
			t.Errorf("expected third track '10_Глава 10', got %q", b2.Tracks[2].Title)
		}
		if b2.CoverPath == "" {
			t.Errorf("expected coverPath to be detected for Мартин Иден")
		}
	}

	// Generation_P
	b3, ok := bookMap["Generation_P"]
	if !ok {
		t.Errorf("book 'Generation_P' not found")
	} else {
		if b3.Author != "Пелевин" {
			t.Errorf("expected author 'Пелевин' for Generation_P, got %q", b3.Author)
		}
		if len(b3.Tracks) != 1 {
			t.Errorf("expected 1 track for Generation_P, got %d", len(b3.Tracks))
		}
	}

	// Ананасная вода для прекрасной дамы
	b4, ok := bookMap["Ананасная вода для прекрасной дамы"]
	if !ok {
		t.Errorf("book 'Ананасная вода для прекрасной дамы' not found")
	} else {
		if b4.Author != "Пелевин" {
			t.Errorf("expected author 'Пелевин', got %q", b4.Author)
		}
		if len(b4.Tracks) != 2 {
			t.Errorf("expected 2 tracks, got %d", len(b4.Tracks))
		}
		if b4.CoverPath == "" {
			t.Errorf("expected coverPath for Ананасная вода")
		}
	}
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write file failed: %v", err)
	}
}
