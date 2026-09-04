package audiobooks

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxArtworkPayloadSize    = 32 * 1024 * 1024 // 32 MiB: maximum embedded artwork picture payload
	MaxMetadataContainerSize = 64 * 1024 * 1024 // 64 MiB: maximum metadata container size (ID3 tag or MP4 moov.udta.meta)
	MaxID3TagSize            = MaxMetadataContainerSize
	MaxMP4MetadataSize       = MaxMetadataContainerSize
)

var (
	ErrNoEmbeddedArtwork = errors.New("no embedded artwork found")
	envelopeChunkSize    = 4096
)

// ExtractEmbeddedArtwork attempts to read embedded cover art from an MP3 (ID3v2 APIC/PIC) or M4B/M4A (MP4 covr) file.
func ExtractEmbeddedArtwork(filePath string) ([]byte, string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return nil, "", err
	}
	fileSize := fi.Size()

	switch ext {
	case ".mp3":
		return extractID3v2Artwork(f, fileSize)
	case ".m4b", ".m4a":
		return extractMP4Artwork(f, fileSize)
	default:
		return nil, "", ErrNoEmbeddedArtwork
	}
}

// extractID3v2Artwork parses ID3v2.2, ID3v2.3, and ID3v2.4 APIC/PIC tags.
func extractID3v2Artwork(r io.ReadSeeker, fileSize int64) ([]byte, string, error) {
	if fileSize < 10 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	var header [10]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, "", ErrNoEmbeddedArtwork
	}

	if string(header[0:3]) != "ID3" {
		return nil, "", ErrNoEmbeddedArtwork
	}

	majorVersion := header[3]
	if majorVersion < 2 || majorVersion > 4 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	// Synchsafe integers must have the high bit cleared in every byte
	if (header[6]|header[7]|header[8]|header[9])&0x80 != 0 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	// Tag size is stored as 4 synchsafe bytes (7 bits each)
	tagSize := int64(header[6])<<21 | int64(header[7])<<14 | int64(header[8])<<7 | int64(header[9])
	if tagSize <= 0 || tagSize > MaxMetadataContainerSize {
		return nil, "", ErrNoEmbeddedArtwork
	}

	// Tag size cannot exceed remaining file bytes
	if tagSize > fileSize-10 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	tagEndPos := 10 + tagSize
	currPos := int64(10)

	// Stream frames without buffering the entire tag in memory
	if majorVersion == 2 {
		// ID3v2.2 uses 3-byte frame IDs and 3-byte sizes
		for currPos+6 <= tagEndPos {
			var frameHeader [6]byte
			if _, err := io.ReadFull(r, frameHeader[:]); err != nil {
				break
			}
			currPos += 6

			if frameHeader[0] == 0 {
				break // Padding
			}

			frameID := string(frameHeader[0:3])
			frameSize := int64(frameHeader[3])<<16 | int64(frameHeader[4])<<8 | int64(frameHeader[5])
			if frameSize <= 0 || frameSize > tagEndPos-currPos {
				break
			}

			if frameID == "PIC" {
				frameStartPos := currPos
				frameEndPos := currPos + frameSize
				if frameSize <= 5 || frameEndPos > tagEndPos {
					break
				}

				if _, err := r.Seek(frameStartPos, io.SeekStart); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}

				var picHdr [5]byte
				if _, err := io.ReadFull(r, picHdr[:]); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}

				encoding := picHdr[0]
				format := strings.ToUpper(string(picHdr[1:4]))
				mime := "image/jpeg"
				if format == "PNG" {
					mime = "image/png"
				}

				descStartPos := frameStartPos + 5
				imgPos, err := findImageStart(r, encoding, descStartPos, frameEndPos)
				if err != nil {
					currPos += frameSize
					if _, err := r.Seek(currPos, io.SeekStart); err != nil {
						break
					}
					continue
				}

				payloadSize := frameEndPos - imgPos
				if payloadSize <= 0 || payloadSize > MaxArtworkPayloadSize {
					return nil, "", ErrNoEmbeddedArtwork
				}

				if _, err := r.Seek(imgPos, io.SeekStart); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}

				data := make([]byte, payloadSize)
				if _, err := io.ReadFull(r, data); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}
				return data, mime, nil
			} else {
				currPos += frameSize
				if _, err := r.Seek(currPos, io.SeekStart); err != nil {
					break
				}
			}
		}
	} else {
		// ID3v2.3 and ID3v2.4 use 4-byte frame IDs, 4-byte sizes, and 2-byte flags
		for currPos+10 <= tagEndPos {
			var frameHeader [10]byte
			if _, err := io.ReadFull(r, frameHeader[:]); err != nil {
				break
			}
			currPos += 10

			if frameHeader[0] == 0 {
				break // Padding
			}

			frameID := string(frameHeader[0:4])
			var frameSize int64
			if majorVersion == 4 {
				// Synchsafe in v2.4
				if (frameHeader[4]|frameHeader[5]|frameHeader[6]|frameHeader[7])&0x80 != 0 {
					break
				}
				frameSize = int64(frameHeader[4])<<21 | int64(frameHeader[5])<<14 | int64(frameHeader[6])<<7 | int64(frameHeader[7])
			} else {
				// Regular uint32 in v2.3
				frameSize = int64(binary.BigEndian.Uint32(frameHeader[4:8]))
			}

			if frameSize <= 0 || frameSize > tagEndPos-currPos {
				break
			}

			if frameID == "APIC" {
				frameStartPos := currPos
				frameEndPos := currPos + frameSize
				if frameSize <= 4 || frameEndPos > tagEndPos {
					break
				}

				if _, err := r.Seek(frameStartPos, io.SeekStart); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}

				var encBuf [1]byte
				if _, err := io.ReadFull(r, encBuf[:]); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}
				encoding := encBuf[0]

				// Search for MIME null terminator streamingly without arbitrary compatibility cap
				mimeStartPos := frameStartPos + 1
				afterMimePos, err := findImageStart(r, 0, mimeStartPos, frameEndPos)
				if err != nil {
					currPos += frameSize
					if _, err := r.Seek(currPos, io.SeekStart); err != nil {
						break
					}
					continue
				}

				if afterMimePos >= frameEndPos {
					return nil, "", ErrNoEmbeddedArtwork
				}

				mimeLen := (afterMimePos - 1) - mimeStartPos
				var mime string
				if mimeLen > 0 {
					readLen := mimeLen
					if readLen > 1024*1024 {
						readLen = 1024 * 1024
					}
					mimeBytes := make([]byte, readLen)
					if _, err := r.Seek(mimeStartPos, io.SeekStart); err != nil {
						return nil, "", ErrNoEmbeddedArtwork
					}
					if _, err := io.ReadFull(r, mimeBytes); err != nil {
						return nil, "", ErrNoEmbeddedArtwork
					}
					mime = string(mimeBytes)
				}
				if mime == "" || mime == "image/" {
					mime = "image/jpeg"
				}

				// The byte at afterMimePos is picType (1 byte)
				descStartPos := afterMimePos + 1
				if descStartPos >= frameEndPos {
					return nil, "", ErrNoEmbeddedArtwork
				}

				imgPos, err := findImageStart(r, encoding, descStartPos, frameEndPos)
				if err != nil {
					currPos += frameSize
					if _, err := r.Seek(currPos, io.SeekStart); err != nil {
						break
					}
					continue
				}

				payloadSize := frameEndPos - imgPos
				if payloadSize <= 0 || payloadSize > MaxArtworkPayloadSize {
					return nil, "", ErrNoEmbeddedArtwork
				}

				if _, err := r.Seek(imgPos, io.SeekStart); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}

				data := make([]byte, payloadSize)
				if _, err := io.ReadFull(r, data); err != nil {
					return nil, "", ErrNoEmbeddedArtwork
				}
				return data, mime, nil
			} else {
				currPos += frameSize
				if _, err := r.Seek(currPos, io.SeekStart); err != nil {
					break
				}
			}
		}
	}

	return nil, "", ErrNoEmbeddedArtwork
}

func findImageStart(r io.ReadSeeker, encoding byte, descStartPos, frameEndPos int64) (int64, error) {
	if descStartPos >= frameEndPos {
		return 0, ErrNoEmbeddedArtwork
	}

	if _, err := r.Seek(descStartPos, io.SeekStart); err != nil {
		return 0, ErrNoEmbeddedArtwork
	}

	chunkSize := envelopeChunkSize
	if chunkSize <= 0 {
		chunkSize = 4096
	}

	currStreamPos := descStartPos
	descOffset := int64(0)

	buf := make([]byte, chunkSize+1)
	bufLen := 0

	for {
		remInFrame := frameEndPos - currStreamPos
		if remInFrame <= 0 {
			// No more bytes in frame to read; check whatever remains in buf
			if encoding == 1 || encoding == 2 {
				for i := 0; i+1 < bufLen; i++ {
					pos := descOffset + int64(i)
					if pos%2 == 0 && buf[i] == 0 && buf[i+1] == 0 {
						return descStartPos + pos + 2, nil
					}
				}
			} else {
				idx := bytes.IndexByte(buf[:bufLen], 0)
				if idx >= 0 {
					return descStartPos + descOffset + int64(idx) + 1, nil
				}
			}
			return 0, ErrNoEmbeddedArtwork
		}

		maxRead := chunkSize - bufLen
		if maxRead <= 0 {
			maxRead = 1
		}
		if int64(maxRead) > remInFrame {
			maxRead = int(remInFrame)
		}

		n, err := r.Read(buf[bufLen : bufLen+maxRead])
		if err != nil && n == 0 {
			return 0, ErrNoEmbeddedArtwork
		}
		bufLen += n
		currStreamPos += int64(n)

		if encoding == 1 || encoding == 2 {
			found := false
			var imgPos int64

			i := 0
			for i < bufLen {
				pos := descOffset + int64(i)
				if pos%2 != 0 {
					i++
					continue
				}

				if i+1 < bufLen {
					if buf[i] == 0 && buf[i+1] == 0 {
						imgPos = descStartPos + pos + 2
						found = true
						break
					}
					i += 2
				} else {
					// i is the last byte in buf and pos is even.
					// Keep this byte as buf[0] for the next chunk read.
					buf[0] = buf[i]
					bufLen = 1
					descOffset = descOffset + int64(i)
					break
				}
			}

			if found {
				return imgPos, nil
			}

			if i == bufLen {
				descOffset += int64(bufLen)
				bufLen = 0
			}
		} else {
			idx := bytes.IndexByte(buf[:bufLen], 0)
			if idx >= 0 {
				return descStartPos + descOffset + int64(idx) + 1, nil
			}
			descOffset += int64(bufLen)
			bufLen = 0
		}
	}
}

// readBoxHeader parses an MP4 box header and validates size, overflow, and boundary constraints.
func readBoxHeader(r io.ReadSeeker, currPos, containerEnd, fileSize int64, isTopLevel bool) (string, int64, int64, error) {
	if currPos < 0 || currPos >= containerEnd || currPos >= fileSize {
		return "", 0, 0, ErrNoEmbeddedArtwork
	}
	if containerEnd-currPos < 8 || fileSize-currPos < 8 {
		return "", 0, 0, ErrNoEmbeddedArtwork
	}

	var header [8]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return "", 0, 0, ErrNoEmbeddedArtwork
	}

	rawSize := uint64(binary.BigEndian.Uint32(header[0:4]))
	boxType := string(header[4:8])

	var headerLen int64 = 8
	var totalBoxSize int64

	switch rawSize {
	case 0:
		// Box extends to end of file, valid only at top level
		if !isTopLevel {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
		totalBoxSize = fileSize - currPos
		if totalBoxSize < 8 {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
	case 1:
		// 64-bit extended size
		if containerEnd-(currPos+8) < 8 || fileSize-(currPos+8) < 8 {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
		var ext [8]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
		extSize := binary.BigEndian.Uint64(ext[:])
		headerLen = 16
		if extSize < 16 || extSize > math.MaxInt64 {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
		totalBoxSize = int64(extSize)
	default:
		if rawSize < 8 {
			return "", 0, 0, ErrNoEmbeddedArtwork
		}
		totalBoxSize = int64(rawSize)
	}

	// Check integer overflow before addition
	if totalBoxSize > math.MaxInt64-currPos {
		return "", 0, 0, ErrNoEmbeddedArtwork
	}
	if currPos+totalBoxSize > containerEnd || currPos+totalBoxSize > fileSize {
		return "", 0, 0, ErrNoEmbeddedArtwork
	}

	return boxType, headerLen, totalBoxSize, nil
}

// extractMP4Artwork traverses MP4/M4B boxes to find moov -> udta -> meta -> ilst -> covr -> data.
func extractMP4Artwork(r io.ReadSeeker, fileSize int64) ([]byte, string, error) {
	if fileSize < 8 {
		return nil, "", ErrNoEmbeddedArtwork
	}

	currPos := int64(0)
	for currPos+8 <= fileSize {
		if _, err := r.Seek(currPos, io.SeekStart); err != nil {
			break
		}
		boxType, headerLen, totalBoxSize, err := readBoxHeader(r, currPos, fileSize, fileSize, true)
		if err != nil {
			break
		}

		if boxType == "moov" {
			return findInContainer(r, currPos+headerLen, currPos+totalBoxSize, fileSize, "udta", func(start, end int64) ([]byte, string, error) {
				return findInContainer(r, start, end, fileSize, "meta", func(start, end int64) ([]byte, string, error) {
					metaSize := end - start
					if metaSize > MaxMetadataContainerSize {
						return nil, "", ErrNoEmbeddedArtwork
					}
					// Meta box has 4 bytes flags/version before child boxes
					if metaSize < 4 {
						return nil, "", ErrNoEmbeddedArtwork
					}
					return findInContainer(r, start+4, end, fileSize, "ilst", func(start, end int64) ([]byte, string, error) {
						ilstSize := end - start
						if ilstSize > MaxMetadataContainerSize {
							return nil, "", ErrNoEmbeddedArtwork
						}
						return findInContainer(r, start, end, fileSize, "covr", func(start, end int64) ([]byte, string, error) {
							return extractCovrData(r, start, end, fileSize)
						})
					})
				})
			})
		}

		currPos += totalBoxSize
	}

	return nil, "", ErrNoEmbeddedArtwork
}

func findInContainer(r io.ReadSeeker, containerStart, containerEnd, fileSize int64, targetType string, handler func(start, end int64) ([]byte, string, error)) ([]byte, string, error) {
	currPos := containerStart
	for currPos+8 <= containerEnd {
		if _, err := r.Seek(currPos, io.SeekStart); err != nil {
			break
		}
		boxType, headerLen, totalBoxSize, err := readBoxHeader(r, currPos, containerEnd, fileSize, false)
		if err != nil {
			break
		}

		if boxType == targetType {
			if (boxType == "meta" || boxType == "ilst") && totalBoxSize > MaxMetadataContainerSize {
				return nil, "", ErrNoEmbeddedArtwork
			}
			return handler(currPos+headerLen, currPos+totalBoxSize)
		}

		currPos += totalBoxSize
	}
	return nil, "", ErrNoEmbeddedArtwork
}

func extractCovrData(r io.ReadSeeker, containerStart, containerEnd, fileSize int64) ([]byte, string, error) {
	currPos := containerStart
	for currPos+8 <= containerEnd {
		if _, err := r.Seek(currPos, io.SeekStart); err != nil {
			break
		}
		boxType, headerLen, totalBoxSize, err := readBoxHeader(r, currPos, containerEnd, fileSize, false)
		if err != nil {
			break
		}

		if boxType == "data" {
			contentSize := totalBoxSize - headerLen
			// data box has 4 bytes typeCode + 4 bytes locale = 8 bytes
			if contentSize < 8 {
				return nil, "", ErrNoEmbeddedArtwork
			}
			payloadSize := contentSize - 8
			if payloadSize <= 0 || payloadSize > MaxArtworkPayloadSize {
				return nil, "", ErrNoEmbeddedArtwork
			}

			dataPos := currPos + headerLen
			if _, err := r.Seek(dataPos, io.SeekStart); err != nil {
				return nil, "", ErrNoEmbeddedArtwork
			}

			var flags [8]byte
			if _, err := io.ReadFull(r, flags[:]); err != nil {
				return nil, "", ErrNoEmbeddedArtwork
			}
			typeCode := binary.BigEndian.Uint32(flags[0:4])
			mime := "image/jpeg"
			if typeCode == 14 {
				mime = "image/png"
			}

			data := make([]byte, payloadSize)
			if _, err := io.ReadFull(r, data); err != nil {
				return nil, "", ErrNoEmbeddedArtwork
			}
			return data, mime, nil
		}

		currPos += totalBoxSize
	}

	return nil, "", ErrNoEmbeddedArtwork
}
