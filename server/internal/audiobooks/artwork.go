package audiobooks

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrNoEmbeddedArtwork = errors.New("no embedded artwork found")
)

// ExtractEmbeddedArtwork attempts to read embedded cover art from an MP3 (ID3v2 APIC) or M4B/M4A (MP4 covr) file.
func ExtractEmbeddedArtwork(filePath string) ([]byte, string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	switch ext {
	case ".mp3":
		return extractID3v2Artwork(f)
	case ".m4b", ".m4a":
		return extractMP4Artwork(f)
	default:
		return nil, "", ErrNoEmbeddedArtwork
	}
}

// extractID3v2Artwork parses ID3v2.2, ID3v2.3, and ID3v2.4 APIC/PIC tags.
func extractID3v2Artwork(r io.ReadSeeker) ([]byte, string, error) {
	header := make([]byte, 10)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, "", ErrNoEmbeddedArtwork
	}

	if string(header[0:3]) != "ID3" {
		return nil, "", ErrNoEmbeddedArtwork
	}

	majorVersion := header[3]
	if majorVersion < 2 || majorVersion > 4 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	// Tag size is stored as 4 synchsafe bytes (7 bits each)
	tagSize := int64(header[6])<<21 | int64(header[7])<<14 | int64(header[8])<<7 | int64(header[9])
	tagData := make([]byte, tagSize)
	if _, err := io.ReadFull(r, tagData); err != nil {
		return nil, "", ErrNoEmbeddedArtwork
	}

	buf := bytes.NewReader(tagData)

	if majorVersion == 2 {
		// ID3v2.2 uses 3-byte frame IDs and 3-byte sizes
		for buf.Len() >= 6 {
			var frameHeader [6]byte
			if _, err := io.ReadFull(buf, frameHeader[:]); err != nil {
				break
			}
			if frameHeader[0] == 0 {
				break // Padding
			}
			frameID := string(frameHeader[0:3])
			frameSize := int(frameHeader[3])<<16 | int(frameHeader[4])<<8 | int(frameHeader[5])
			if frameSize <= 0 || frameSize > buf.Len() {
				break
			}
			frameBody := make([]byte, frameSize)
			if _, err := io.ReadFull(buf, frameBody); err != nil {
				break
			}

			if frameID == "PIC" && len(frameBody) > 5 {
				// PIC: encoding(1) + format(3, e.g. "JPG"/"PNG") + picType(1) + description(null-terminated) + data
				format := strings.ToUpper(string(frameBody[1:4]))
				mime := "image/jpeg"
				if format == "PNG" {
					mime = "image/png"
				}
				picBody := frameBody[5:]
				// Skip null-terminated description
				nullIdx := bytes.IndexByte(picBody, 0)
				if nullIdx >= 0 && nullIdx+1 < len(picBody) {
					return picBody[nullIdx+1:], mime, nil
				}
			}
		}
	} else {
		// ID3v2.3 and ID3v2.4 use 4-byte frame IDs and 4-byte sizes
		for buf.Len() >= 10 {
			var frameHeader [10]byte
			if _, err := io.ReadFull(buf, frameHeader[:]); err != nil {
				break
			}
			if frameHeader[0] == 0 {
				break // Padding
			}
			frameID := string(frameHeader[0:4])
			var frameSize int64
			if majorVersion == 4 {
				// Synchsafe in v2.4
				frameSize = int64(frameHeader[4])<<21 | int64(frameHeader[5])<<14 | int64(frameHeader[6])<<7 | int64(frameHeader[7])
			} else {
				// Regular uint32 in v2.3
				frameSize = int64(binary.BigEndian.Uint32(frameHeader[4:8]))
			}

			if frameSize <= 0 || frameSize > int64(buf.Len()) {
				break
			}
			frameBody := make([]byte, frameSize)
			if _, err := io.ReadFull(buf, frameBody); err != nil {
				break
			}

			if frameID == "APIC" && len(frameBody) > 4 {
				encoding := frameBody[0]
				body := frameBody[1:]

				// MIME type is null-terminated ASCII
				nullMime := bytes.IndexByte(body, 0)
				if nullMime < 0 || nullMime+2 >= len(body) {
					continue
				}
				mime := string(body[:nullMime])
				if mime == "" || mime == "image/" {
					mime = "image/jpeg"
				}

				afterMime := body[nullMime+1:]
				// Picture type byte
				afterPicType := afterMime[1:]

				// Skip description based on encoding (0/3 = 1 null byte, 1/2 = 2 null bytes)
				var imgStart int
				if encoding == 1 || encoding == 2 {
					// 2-byte null terminator for UTF-16
					for i := 0; i < len(afterPicType)-1; i += 2 {
						if afterPicType[i] == 0 && afterPicType[i+1] == 0 {
							imgStart = i + 2
							break
						}
					}
				} else {
					nullDesc := bytes.IndexByte(afterPicType, 0)
					if nullDesc >= 0 {
						imgStart = nullDesc + 1
					}
				}

				if imgStart > 0 && imgStart < len(afterPicType) {
					imgData := afterPicType[imgStart:]
					if len(imgData) > 0 {
						return imgData, mime, nil
					}
				}
			}
		}
	}

	return nil, "", ErrNoEmbeddedArtwork
}

// extractMP4Artwork traverses MP4/M4B boxes to find moov -> udta -> meta -> ilst -> covr -> data.
func extractMP4Artwork(r io.ReadSeeker) ([]byte, string, error) {
	for {
		var header [8]byte
		if _, err := io.ReadFull(r, header[:]); err != nil {
			break
		}
		boxSize := int64(binary.BigEndian.Uint32(header[0:4]))
		boxType := string(header[4:8])

		if boxSize == 1 {
			// 64-bit large size
			var extSize [8]byte
			if _, err := io.ReadFull(r, extSize[:]); err != nil {
				break
			}
			boxSize = int64(binary.BigEndian.Uint64(extSize[:])) - 16
		} else if boxSize >= 8 {
			boxSize -= 8
		} else {
			break
		}

		if boxType == "moov" {
			return findInContainer(r, boxSize, "udta", func(r io.ReadSeeker, size int64) ([]byte, string, error) {
				return findInContainer(r, size, "meta", func(r io.ReadSeeker, size int64) ([]byte, string, error) {
					// Meta box has 4 bytes flags/version before children
					if size < 4 {
						return nil, "", ErrNoEmbeddedArtwork
					}
					if _, err := r.Seek(4, io.SeekCurrent); err != nil {
						return nil, "", err
					}
					size -= 4
					return findInContainer(r, size, "ilst", func(r io.ReadSeeker, size int64) ([]byte, string, error) {
						return findInContainer(r, size, "covr", func(r io.ReadSeeker, size int64) ([]byte, string, error) {
							return extractCovrData(r, size)
						})
					})
				})
			})
		}

		if _, err := r.Seek(boxSize, io.SeekCurrent); err != nil {
			break
		}
	}

	return nil, "", ErrNoEmbeddedArtwork
}

type boxHandler func(r io.ReadSeeker, size int64) ([]byte, string, error)

func findInContainer(r io.ReadSeeker, containerSize int64, targetType string, handler boxHandler) ([]byte, string, error) {
	endPos, err := r.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil, "", err
	}
	endPos += containerSize

	for {
		currPos, err := r.Seek(0, io.SeekCurrent)
		if err != nil || currPos >= endPos {
			break
		}

		var header [8]byte
		if _, err := io.ReadFull(r, header[:]); err != nil {
			break
		}
		boxSize := int64(binary.BigEndian.Uint32(header[0:4]))
		boxType := string(header[4:8])

		if boxSize < 8 {
			break
		}
		contentSize := boxSize - 8

		if boxType == targetType {
			return handler(r, contentSize)
		}

		if _, err := r.Seek(contentSize, io.SeekCurrent); err != nil {
			break
		}
	}

	return nil, "", ErrNoEmbeddedArtwork
}

func extractCovrData(r io.ReadSeeker, size int64) ([]byte, string, error) {
	endPos, err := r.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil, "", err
	}
	endPos += size

	for {
		currPos, err := r.Seek(0, io.SeekCurrent)
		if err != nil || currPos >= endPos {
			break
		}

		var header [8]byte
		if _, err := io.ReadFull(r, header[:]); err != nil {
			break
		}
		boxSize := int64(binary.BigEndian.Uint32(header[0:4]))
		boxType := string(header[4:8])

		if boxSize < 8 {
			break
		}
		contentSize := boxSize - 8

		if boxType == "data" && contentSize >= 8 {
			var flags [8]byte
			if _, err := io.ReadFull(r, flags[:]); err != nil {
				return nil, "", err
			}
			typeCode := binary.BigEndian.Uint32(flags[0:4])
			mime := "image/jpeg"
			if typeCode == 14 {
				mime = "image/png"
			}

			payloadSize := contentSize - 8
			data := make([]byte, payloadSize)
			if _, err := io.ReadFull(r, data); err != nil {
				return nil, "", err
			}
			return data, mime, nil
		}

		if _, err := r.Seek(contentSize, io.SeekCurrent); err != nil {
			break
		}
	}

	return nil, "", ErrNoEmbeddedArtwork
}
