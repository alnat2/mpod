package audiobooks

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

var ErrAudioDurationUnavailable = errors.New("audio duration unavailable")

// ReadAudioDuration reads duration metadata without decoding or modifying the file.
func ReadAudioDuration(filePath string) (int64, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	var seconds float64
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".mp3":
		seconds, err = readMP3Duration(f)
	case ".m4a", ".m4b":
		seconds, err = readMP4Duration(f)
	default:
		return 0, ErrAudioDurationUnavailable
	}
	if err != nil {
		return 0, err
	}
	if seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, ErrAudioDurationUnavailable
	}
	return max(1, int64(math.Round(seconds))), nil
}

type mp3Frame struct {
	length     int64
	samples    int
	sampleRate int
}

func readMP3Duration(r io.ReadSeeker) (float64, error) {
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}
	offset := int64(0)
	var id3Header [10]byte
	if _, err := r.Seek(0, io.SeekStart); err == nil {
		if _, err := io.ReadFull(r, id3Header[:]); err == nil && string(id3Header[:3]) == "ID3" {
			tagSize := int64(id3Header[6])<<21 | int64(id3Header[7])<<14 | int64(id3Header[8])<<7 | int64(id3Header[9])
			offset = 10 + tagSize
			if id3Header[5]&0x10 != 0 {
				offset += 10
			}
		}
	}

	var totalSeconds float64
	frames := 0
	resyncBytes := 0
	var header [4]byte
	for offset+4 <= end {
		if _, err := r.Seek(offset, io.SeekStart); err != nil {
			return 0, err
		}
		if _, err := io.ReadFull(r, header[:]); err != nil {
			break
		}
		frame, ok := parseMP3FrameHeader(binary.BigEndian.Uint32(header[:]))
		if !ok || offset+frame.length > end {
			offset++
			resyncBytes++
			if frames > 0 && resyncBytes > 4096 {
				break
			}
			continue
		}

		totalSeconds += float64(frame.samples) / float64(frame.sampleRate)
		frames++
		resyncBytes = 0
		offset += frame.length
	}
	if frames == 0 {
		return 0, ErrAudioDurationUnavailable
	}
	return totalSeconds, nil
}

func parseMP3FrameHeader(header uint32) (mp3Frame, bool) {
	if header&0xffe00000 != 0xffe00000 {
		return mp3Frame{}, false
	}
	versionBits := (header >> 19) & 0x3
	layerBits := (header >> 17) & 0x3
	bitrateIndex := int((header >> 12) & 0xf)
	sampleRateIndex := int((header >> 10) & 0x3)
	padding := int((header >> 9) & 0x1)
	if versionBits == 1 || layerBits == 0 || bitrateIndex == 0 || bitrateIndex == 15 || sampleRateIndex == 3 {
		return mp3Frame{}, false
	}

	baseRates := [...]int{44100, 48000, 32000}
	sampleRate := baseRates[sampleRateIndex]
	if versionBits == 2 {
		sampleRate /= 2
	} else if versionBits == 0 {
		sampleRate /= 4
	}

	// layerBits: 3 = Layer I, 2 = Layer II, 1 = Layer III.
	var bitrate int
	if versionBits == 3 {
		switch layerBits {
		case 3:
			bitrate = [...]int{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448}[bitrateIndex]
		case 2:
			bitrate = [...]int{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384}[bitrateIndex]
		case 1:
			bitrate = [...]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}[bitrateIndex]
		}
	} else if layerBits == 3 {
		bitrate = [...]int{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256}[bitrateIndex]
	} else {
		bitrate = [...]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160}[bitrateIndex]
	}
	if bitrate == 0 || sampleRate == 0 {
		return mp3Frame{}, false
	}

	frame := mp3Frame{sampleRate: sampleRate}
	switch layerBits {
	case 3:
		frame.samples = 384
		frame.length = int64((12*bitrate*1000/sampleRate + padding) * 4)
	case 2:
		frame.samples = 1152
		frame.length = int64(144*bitrate*1000/sampleRate + padding)
	case 1:
		coefficient := 144
		frame.samples = 1152
		if versionBits != 3 {
			coefficient = 72
			frame.samples = 576
		}
		frame.length = int64(coefficient*bitrate*1000/sampleRate + padding)
	}
	return frame, frame.length >= 4
}

func readMP4Duration(r io.ReadSeeker) (float64, error) {
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}
	for offset := int64(0); offset+8 <= end; {
		boxType, contentOffset, boxEnd, err := readMP4BoxHeader(r, offset, end)
		if err != nil {
			return 0, err
		}
		if boxType == "moov" {
			return readMovieHeaderDuration(r, contentOffset, boxEnd)
		}
		offset = boxEnd
	}
	return 0, ErrAudioDurationUnavailable
}

func readMovieHeaderDuration(r io.ReadSeeker, start, end int64) (float64, error) {
	for offset := start; offset+8 <= end; {
		boxType, contentOffset, boxEnd, err := readMP4BoxHeader(r, offset, end)
		if err != nil {
			return 0, err
		}
		if boxType == "mvhd" {
			return parseMovieHeader(r, contentOffset, boxEnd-contentOffset)
		}
		offset = boxEnd
	}
	return 0, ErrAudioDurationUnavailable
}

func readMP4BoxHeader(r io.ReadSeeker, offset, containerEnd int64) (string, int64, int64, error) {
	if _, err := r.Seek(offset, io.SeekStart); err != nil {
		return "", 0, 0, err
	}
	var header [8]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return "", 0, 0, err
	}
	size := int64(binary.BigEndian.Uint32(header[:4]))
	headerSize := int64(8)
	if size == 1 {
		var extended [8]byte
		if _, err := io.ReadFull(r, extended[:]); err != nil {
			return "", 0, 0, err
		}
		size = int64(binary.BigEndian.Uint64(extended[:]))
		headerSize = 16
	} else if size == 0 {
		size = containerEnd - offset
	}
	if size < headerSize || offset+size > containerEnd {
		return "", 0, 0, fmt.Errorf("invalid MP4 box at offset %d", offset)
	}
	return string(header[4:8]), offset + headerSize, offset + size, nil
}

func parseMovieHeader(r io.ReadSeeker, offset, size int64) (float64, error) {
	if size < 20 {
		return 0, ErrAudioDurationUnavailable
	}
	if _, err := r.Seek(offset, io.SeekStart); err != nil {
		return 0, err
	}
	buf := make([]byte, min(size, 32))
	if _, err := io.ReadFull(r, buf); err != nil {
		return 0, err
	}
	var timescale uint32
	var duration uint64
	if buf[0] == 1 {
		if len(buf) < 32 {
			return 0, ErrAudioDurationUnavailable
		}
		timescale = binary.BigEndian.Uint32(buf[20:24])
		duration = binary.BigEndian.Uint64(buf[24:32])
	} else {
		timescale = binary.BigEndian.Uint32(buf[12:16])
		duration = uint64(binary.BigEndian.Uint32(buf[16:20]))
	}
	if timescale == 0 || duration == 0 {
		return 0, ErrAudioDurationUnavailable
	}
	return float64(duration) / float64(timescale), nil
}
