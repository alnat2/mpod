# mpod — Product Requirements Document (PRD)

## 1. Product Overview

mpod is a simple personal web application to manage podcasts: import RSS or OPML feeds, download episodes, create playlists, and listen across devices with synced playback position.

---

## 2. Goals

- Simple personal podcast manager
- RSS and OPML import/export
- Cross-device playback resume
- Episode downloading
- Docker-based deployment
- SOCKS5 proxy support
- Minimal and fast interface

---

## 3. Target User

Single user (personal use)

Needs:
- Manage podcast subscriptions
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

## Episode Management

- Download episodes
- Add/remove from playlist
- Mark as listened/unlistened
- Episode is marked as listened when playback reaches 100 percent

---

## Playlist

- Add/remove episodes
- Reorder playlist
- Sequential playback

---

## Audio Player

- Play / Pause
- Seek
- Skip forward/back
- Speed control (0.5x–2x)
- Track playback position

---

## Playback Sync

- Save playback position periodically
- Resume on another device

---

## Auto Cleanup

- Remove episode from playlist after completion
- Deletion of downloaded file

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

### Settings
- Configure daily refresh time
- Enable or disable use of the configured SOCKS5 proxy

### Episodes
- Download episodes
- Manage playlist
- Mark listened or unlistened

### Player
- Playback controls
- Speed control
- Seek
- Save playback progress

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

### Playlist
| Field | Type |
|------|------|
| id | integer |
| episode_id | integer |
| position | integer |

---

### Playback
| Field | Type |
|------|------|
| episode_id | integer |
| position_seconds | integer |
| last_updated | datetime |

---

## 9. Scheduler

- Runs once per day at configured time
- Checks all podcasts
- Fetches updates using proxy if configured
- Stores new episodes
