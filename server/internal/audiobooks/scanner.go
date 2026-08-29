package audiobooks

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

var supportedAudioExts = map[string]bool{
	".mp3": true,
	".m4b": true,
	".m4a": true,
}

var supportedCoverNames = map[string]bool{
	"cover.jpg":  true,
	"cover.jpeg": true,
	"cover.png":  true,
	"folder.jpg": true,
	"folder.png": true,
}

func isAudioFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return supportedAudioExts[ext]
}

func isCoverFile(name string) bool {
	return supportedCoverNames[strings.ToLower(name)]
}

// NaturalSort sorts strings considering embedded numbers (e.g. "01", "2", "10").
func naturalLess(s1, s2 string) bool {
	chunks1 := splitChunks(s1)
	chunks2 := splitChunks(s2)

	minLen := len(chunks1)
	if len(chunks2) < minLen {
		minLen = len(chunks2)
	}

	for i := 0; i < minLen; i++ {
		c1, c2 := chunks1[i], chunks2[i]
		if c1 == c2 {
			continue
		}

		n1, err1 := strconv.ParseUint(c1, 10, 64)
		n2, err2 := strconv.ParseUint(c2, 10, 64)

		if err1 == nil && err2 == nil {
			if n1 != n2 {
				return n1 < n2
			}
			// If numerical values are equal, compare lengths (e.g. "01" vs "1")
			if len(c1) != len(c2) {
				return len(c1) < len(c2)
			}
		} else {
			l1, l2 := strings.ToLower(c1), strings.ToLower(c2)
			if l1 != l2 {
				return l1 < l2
			}
			return c1 < c2
		}
	}

	return len(chunks1) < len(chunks2)
}

func splitChunks(s string) []string {
	var chunks []string
	var current strings.Builder
	var isDigit bool

	for i, r := range s {
		d := unicode.IsDigit(r)
		if i == 0 {
			isDigit = d
			current.WriteRune(r)
			continue
		}

		if d == isDigit {
			current.WriteRune(r)
		} else {
			chunks = append(chunks, current.String())
			current.Reset()
			current.WriteRune(r)
			isDigit = d
		}
	}

	if current.Len() > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

type dirContent struct {
	path       string
	relPath    string
	audioFiles []string
	subDirs    []string
	coverFile  string
}

// ScanDirectory scans rootDir and groups files into ScannedBook items.
func ScanDirectory(rootDir string) ([]ScannedBook, error) {
	cleanRoot := filepath.Clean(rootDir)
	info, err := os.Stat(cleanRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat audiobooks root: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("audiobooks path is not a directory: %s", cleanRoot)
	}

	dirMap := make(map[string]*dirContent)

	err = filepath.WalkDir(cleanRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			// Skip unreadable files or directories, but fail if root is unreadable
			if path == cleanRoot {
				return walkErr
			}
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip hidden files and directories
		if strings.HasPrefix(d.Name(), ".") && path != cleanRoot {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			rel, _ := filepath.Rel(cleanRoot, path)
			dirMap[path] = &dirContent{
				path:    path,
				relPath: rel,
			}
			return nil
		}

		dir := filepath.Dir(path)
		entry := dirMap[dir]
		if entry == nil {
			rel, _ := filepath.Rel(cleanRoot, dir)
			entry = &dirContent{path: dir, relPath: rel}
			dirMap[dir] = entry
		}

		if isAudioFile(d.Name()) {
			entry.audioFiles = append(entry.audioFiles, path)
		} else if isCoverFile(d.Name()) && entry.coverFile == "" {
			entry.coverFile = path
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("walk audiobooks directory: %w", err)
	}

	// Update subDirs relationships
	for path := range dirMap {
		if path == cleanRoot {
			continue
		}
		parent := filepath.Dir(path)
		if pContent, ok := dirMap[parent]; ok {
			pContent.subDirs = append(pContent.subDirs, path)
		}
	}

	var books []ScannedBook

	// Sort dir keys for deterministic processing
	var sortedPaths []string
	for p := range dirMap {
		sortedPaths = append(sortedPaths, p)
	}
	sort.Slice(sortedPaths, func(i, j int) bool {
		return naturalLess(sortedPaths[i], sortedPaths[j])
	})

	for _, path := range sortedPaths {
		content := dirMap[path]
		if len(content.audioFiles) == 0 {
			continue
		}

		hasSubdirWithAudio := false
		for _, sub := range content.subDirs {
			if subContent, ok := dirMap[sub]; ok && (len(subContent.audioFiles) > 0 || len(subContent.subDirs) > 0) {
				hasSubdirWithAudio = true
				break
			}
		}

		// A directory is treated as a single multi-track or single-track book only if
		// it is not the root library folder and contains no subdirectories with audio.
		isLeafMultiTrackBook := path != cleanRoot && !hasSubdirWithAudio && len(content.audioFiles) > 0

		if isLeafMultiTrackBook {
			// Directory itself is the book
			sort.Slice(content.audioFiles, func(i, j int) bool {
				return naturalLess(filepath.Base(content.audioFiles[i]), filepath.Base(content.audioFiles[j]))
			})

			bookTitle := filepath.Base(path)
			author := ""
			parentPath := filepath.Dir(path)
			if parentPath != cleanRoot {
				author = filepath.Base(parentPath)
			}

			relBookPath, _ := filepath.Rel(cleanRoot, path)
			coverRel := ""
			if content.coverFile != "" {
				coverRel, _ = filepath.Rel(cleanRoot, content.coverFile)
			}

			var tracks []ScannedTrack
			for idx, af := range content.audioFiles {
				trackRel, _ := filepath.Rel(cleanRoot, af)
				fileName := filepath.Base(af)
				trackTitle := strings.TrimSuffix(fileName, filepath.Ext(fileName))
				duration, _ := ReadAudioDuration(af)

				tracks = append(tracks, ScannedTrack{
					TrackNumber: idx + 1,
					Title:       trackTitle,
					RelPath:     trackRel,
					FilePath:    af,
					Duration:    duration,
				})
			}

			if coverRel == "" && len(content.audioFiles) > 0 {
				if _, _, err := ExtractEmbeddedArtwork(content.audioFiles[0]); err == nil {
					firstTrackRel, _ := filepath.Rel(cleanRoot, content.audioFiles[0])
					coverRel = "embedded:" + firstTrackRel
				}
			}

			books = append(books, ScannedBook{
				Title:     bookTitle,
				Author:    author,
				RelPath:   relBookPath,
				CoverPath: coverRel,
				Tracks:    tracks,
			})
		} else {
			// Standalone audio files in root or author/category directories
			for _, af := range content.audioFiles {
				fileName := filepath.Base(af)
				bookTitle := strings.TrimSuffix(fileName, filepath.Ext(fileName))
				author := ""
				if path != cleanRoot {
					author = filepath.Base(path)
				}

				trackRel, _ := filepath.Rel(cleanRoot, af)
				duration, _ := ReadAudioDuration(af)
				coverRel := ""
				if content.coverFile != "" {
					coverRel, _ = filepath.Rel(cleanRoot, content.coverFile)
				} else if _, _, err := ExtractEmbeddedArtwork(af); err == nil {
					coverRel = "embedded:" + trackRel
				}

				tracks := []ScannedTrack{
					{
						TrackNumber: 1,
						Title:       bookTitle,
						RelPath:     trackRel,
						FilePath:    af,
						Duration:    duration,
					},
				}

				books = append(books, ScannedBook{
					Title:     bookTitle,
					Author:    author,
					RelPath:   trackRel,
					CoverPath: coverRel,
					Tracks:    tracks,
				})
			}
		}
	}

	sort.Slice(books, func(i, j int) bool {
		if books[i].Author != books[j].Author {
			return naturalLess(books[i].Author, books[j].Author)
		}
		return naturalLess(books[i].Title, books[j].Title)
	})

	return books, nil
}
