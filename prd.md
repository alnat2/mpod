# mpod — Product Requirements Document (PRD)

## 1. Product Overview

mpod is a simple personal web application to manage podcasts and audiobooks: import RSS or OPML feeds, scan local audiobooks, download episodes, create playlists, and listen across devices with synced playback position.

---

## 2. Goals

- Simple personal podcast and audiobook manager
- RSS and OPML import/export
- Local audiobooks library scanning with automatic directory watching (inotify)
- Cross-device playback resume for podcasts and audiobooks
- Episode downloading for podcasts
- Docker-based deployment
- SOCKS5 proxy support
- Minimal and fast interface

---

## 3. Target User

Single user (personal use)

Needs:
- Manage podcast subscriptions
- Listen to local audiobooks with chapter navigation
- Download and organize episodes
- Resume playback across devices
- Operate in restricted networks if needed

---

## 4. Core Features

## Authentication

- Username/password login
- Session-based authentication
- No public registration

---

## Podcast Management

### RSS Feed
- Add via URL
- Fetch and parse feed
- Store episodes

### OPML
- Import feeds from OPML file
- Export subscriptions as OPML

---

## Audiobook Management

### Library Directory
- Scans a configured local directory (`AUDIOBOOKS_DIR`, default `/share/audio/abooks/`)
- Automatically detects changes via Linux `inotify` (`fsnotify`) with debounced rescanning
- Supported audio formats: `.mp3`, `.m4b`, `.m4a`
- File explorer displays only supported audio extensions and directories; unsupported files are filtered out
- Folder structure mapping:
  - A directory with direct supported audio files -> one folder-backed audiobook; folder name = book title, parent folder = author, direct audio files = chapters/tracks sorted naturally
  - A directory with no direct supported audio files -> collection folder used only to navigate to the next level
  - Standalone supported audio file -> one single-track audiobook; filename = book title, parent folder = author
  - The supported library layout does not mix direct audiobook tracks and nested book directories inside the same directory
- Automatic cover art extraction: folder images (`cover.jpg`/`png`), embedded ID3v2 APIC (MP3), MP4 `covr` (M4B/M4A), or official 3D fallback (`fallback-audio`)
- Default playback speed for audiobooks is `1.0x` (`Speed 1x`), preserving natural narrative pacing; podcasts default to `Speed 1.3x`
- Podcast and audiobook playback speeds are remembered separately and synchronized through backend-owned settings

### Playlist Presentation & Chapters
- An audiobook is represented in the playlist queue as a single compact item displaying current chapter and progress
- A folder-backed audiobook remains one playlist item whether the user adds the whole folder or only selected chapters
- Adding a chapter merges it into the existing playlist item for that book; adding the whole book fills the same item with every missing chapter
- Selected chapters follow natural filename order, not the order in which they were added
- Removing the final selected chapter removes the book from the playlist without deleting source files
- Opening a folder-backed book from `Abooks` shows a library chapter-selection modal with chapter name, duration, and add/remove-from-playlist action; it does not expose playback controls
- Clicking the audiobook playlist item or "Show Chapters" in the player opens a playback chapters modal with chapter progress and playback actions
- Completed chapters remain visible in the playback chapters modal and can be replayed from `0:00`
- Sequential playback automatically advances to the next selected chapter upon completion; when the final top-level item completes, playback wraps to the first eligible remaining podcast episode or audiobook
- When the final selected chapter becomes listened, the book is removed from the playlist
- Removing and later re-adding a book resets its chapter progress and listened state so playback starts over
- Library rescans do not inject newly discovered tracks into an already configured playlist item
- Audiobook files on disk are permanent library assets and are strictly read-only: mpod never deletes audiobook files from disk under any circumstance

---

## Episode Management

- Download episodes
- Add/remove from playlist
- Mark as listened/unlistened
- Episode is marked as listened only after a client reports actual audio completion

---

## Playlist

- Add/remove episodes, standalone audiobook files, folder-backed books, and selected audiobook chapters
- Reorder playlist
- Keep selected chapters from one folder-backed book in a single ordered playlist item
- Sequential playback across items and selected audiobook chapters

---

## Audio Player

- Play / Pause
- Seek
- Skip forward/back
- Speed control (0.5x–2x)
- Track playback position
- "Show Notes" for podcast episodes / "Show Chapters" for folder-backed multi-track audiobooks / no secondary content action for standalone audiobook files
- Direct `Go to time` input supporting hours and minutes for long media
- Separate remembered speed preference for podcasts and audiobooks

---

## Playback Sync

- Save playback position periodically
- Resume on another device
- Treat ordinary progress updates, including near-end progress, as position sync only
- Send explicit completion separately from progress sync

---

## Auto Cleanup

- Remove a podcast episode after completion and remove a book after its final selected chapter becomes listened
- Deletion of downloaded podcast files (audiobook files are preserved)

---

## Podcast Updates

### Manual
- User triggers refresh

### Automatic
- Runs once per day at a user-defined time
- Fetches RSS feeds
- Adds new episodes

---

## 5. Functional Requirements

### Authentication
- Login and logout
- Session handling

### Podcasts
- Add RSS feed
- Import OPML
- Export OPML
- Manual refresh
- Scheduled updates

### Audiobooks
- Scan local audiobooks directory
- Automatic change detection via inotify
- Browse audiobooks and chapter lists
- Navigate collection folders
- Add/remove whole books or selected chapters to/from one aggregated playlist item per book

### Settings
- Configure daily refresh time
- Enable or disable use of the configured SOCKS5 proxy
- Store separate podcast and audiobook playback speed preferences

### Episodes
- Download episodes
- Manage playlist
- Mark listened or unlistened

### Player
- Playback controls
- Speed control
- Seek
- Save playback progress
- Chapter navigation for audiobooks

---

## 6. Non-Functional Requirements

### Performance
- Player start time under 2 seconds

### Compatibility
- Modern desktop and mobile browsers

### Security
- Password hashing
- Secure cookies

### Simplicity
- Minimal user interface

---

## Deployment

- Runs inside a Docker container
- Configuration via environment variables
- Persistent storage via mounted volumes

---

## Network

- Supports SOCKS5 proxy
- User can enable or disable proxy usage in Settings when proxy configuration is available

Environment variables:

SOCKS5_HOST  
SOCKS5_PORT  
SOCKS5_USERNAME (optional)  
SOCKS5_PASSWORD (optional)  
AUDIOBOOKS_DIR (default /share/audio/abooks/)

Used for:
- RSS feed fetching
- Episode streaming
- Episode downloads
- Manual and scheduled feed refresh

---

## 7. Tech Stack

Frontend:
- React

Backend:
- Go

Database:
- SQLite

Storage:
- Local filesystem (Docker volume)

---

## 8. Database Schema

### Users
| Field | Type |
|------|------|
| id | integer |
| username | text |
| password_hash | text |

---

### Podcasts
| Field | Type |
|------|------|
| id | integer |
| title | text |
| rss_url | text |
| last_checked | datetime |
| update_time | time |

---

### Episodes
| Field | Type |
|------|------|
| id | integer |
| podcast_id | integer |
| title | text |
| audio_url | text |
| duration | integer |
| downloaded_path | text |
| is_listened | boolean |
| published_at | datetime |

---

### Audiobooks
| Field | Type |
|------|------|
| id | integer |
| title | text |
| author | text |
| rel_path | text |
| cover_url | text |
| total_duration | integer |
| created_at | datetime |
| updated_at | datetime |

---

### Audiobook Tracks
| Field | Type |
|------|------|
| id | integer |
| audiobook_id | integer |
| track_number | integer |
| title | text |
| rel_path | text |
| duration | integer |
| is_listened | boolean |
| created_at | datetime |

---

### Playlist
| Field | Type |
|------|------|
| id | integer |
| episode_id | integer (nullable) |
| audiobook_id | integer (nullable) |
| position | integer |

---

### Audiobook Playlist Tracks
| Field | Type |
|------|------|
| audiobook_id | integer |
| track_id | integer |
| added_at | datetime |

Each row records a chapter selected inside a folder-backed audiobook's single playlist item. Chapters without a row are simply not part of that playlist item; they are not separate or excluded playlist entries.

---

### Playback
| Field | Type |
|------|------|
| episode_id | integer (nullable) |
| audiobook_track_id | integer (nullable) |
| position_seconds | integer |
| last_updated | datetime |

---

## 9. Scheduler

- Runs once per day at configured time
- Checks all podcasts
- Fetches updates using proxy if configured
- Stores new episodes
