# Roadmap

## Current State (v1.0)

| Platform | Tools | Media Download | Transcription |
|---|---|---|---|
| Twitter/X | 26 tools (tweets, profiles, search, trends, monitoring, filters) | Video via direct fetch | Whisper (local) |
| YouTube | 1 tool (transcript) | Audio via yt-dlp | Captions or Whisper |
| Instagram | 1 tool (post/reel/carousel) | Images + video via Cobalt | Whisper (local) |
| Any video URL | 1 tool (frame extraction) | Video via yt-dlp or direct fetch | N/A (frames only) |

## v1.1 — TikTok Support

Cobalt already handles TikTok with watermark removal, slideshow images, and original audio.

- `get_tiktok_video` — Download video by URL, return local path + transcription
- `get_tiktok_slides` — Download slideshow images to folder
- Automatic watermark-free downloads via Cobalt
- Whisper transcription for video audio

## v1.2 — Reddit & Bluesky

Both supported by Cobalt out of the box.

- `get_reddit_post` — Download Reddit video/GIF by URL with transcription
- `get_bluesky_post` — Fetch Bluesky post with media download and transcription

## v1.3 — Facebook, Pinterest, Snapchat

Cobalt covers all three.

- `get_facebook_video` — Download public Facebook videos
- `get_pinterest_media` — Download pins (photos, GIFs, videos, stories)
- `get_snapchat_spotlight` — Download Snapchat spotlights and stories

## v1.4 — Unified Media Pipeline

Replace per-platform download logic with a single Cobalt-backed pipeline.

- `download_media` — Universal tool that accepts any URL from any supported platform
- Auto-detects platform from URL
- Returns local file paths for images/video + transcription
- Single Cobalt API call replaces yt-dlp + direct fetch + platform-specific code
- Covers all 21 Cobalt-supported services through one tool

### Full Cobalt Platform Coverage

| Service | Type |
|---|---|
| YouTube | Video, audio, 8K, HDR |
| Instagram | Reels, photos, carousels |
| TikTok | Video (no watermark), slideshows |
| Twitter/X | Video, multi-media |
| Reddit | Video, GIFs |
| Facebook | Public videos |
| Pinterest | Photos, GIFs, videos, stories |
| Snapchat | Spotlights, stories |
| Bluesky | Video |
| Twitch | Clips |
| Vimeo | Video |
| SoundCloud | Audio |
| Dailymotion | Video |
| Tumblr | Video |
| Bilibili | Video |
| Loom | Video |
| Streamable | Video |
| Rutube | Video, private links |
| Newgrounds | Video |
| OK.ru | Video |
| VK | Video, clips |

## v1.5 — Streaming & Live Content

- Twitter Spaces audio recording + transcription
- Twitch clip transcription
- Live stream snapshot extraction

## v2.0 — Structured Data & Analytics

- `analyze_account` — Cross-platform account analysis (follower overlap, posting patterns, engagement rates)
- `compare_posts` — Side-by-side metrics comparison across platforms
- Structured JSON output mode for all tools (in addition to formatted text)
- Batch operations — fetch multiple URLs in a single tool call

## Backlog

- Spotify podcast episode transcription (via Cobalt audio extraction)
- Multi-language Whisper transcription (currently hardcoded to English)
- Larger Whisper models as an option (base → small → medium) for better accuracy
- Image OCR for screenshot text extraction
- npx support (`npx media-mcp` to run without cloning)
- Docker image for one-command deployment
