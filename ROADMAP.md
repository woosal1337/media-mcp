# Roadmap

## Current State (v1.1 — Ears always, eyes when needed)

| Platform | Tools | Media Download | Transcription |
|---|---|---|---|
| Twitter/X | 26 tools (tweets, profiles, search, trends, monitoring, filters) | Video via direct fetch, cached 24h | Whisper (local) with per-token confidence |
| YouTube | 1 tool (transcript) | Audio via yt-dlp | Captions (instant) or Whisper with per-token confidence |
| Instagram | 1 tool (post/reel/carousel) | Images + video via Cobalt, cached 24h | Whisper (local) with per-token confidence |
| Any video URL | 2 tools (bulk + precision frame extraction) | Video via yt-dlp or direct fetch, cached 24h | N/A (frames only) |
| Any webpage | 1 tool (Cloudflare Browser Run markdown) | — | — |

### What shipped in v1.1

- **Per-token Whisper confidence.** All transcription tools now use `whisper-cli -ojf` (output-json-full) and parse per-token probabilities.
- **Uncertainty zones.** Contiguous runs of tokens below the confidence threshold (default p < 0.5, merged within 150ms) are surfaced with `midpoint_s` timestamps the LLM can feed to the precision frame tool.
- **Demonstrative-phrase detection.** Regex scan for phrases like "visit our", "this command", "in the bio" that signal on-screen content is being referenced without transcription capturing it.
- **`get_video_frames_at` tool.** Precision frame extraction — one JPG per requested timestamp. The natural companion to the transcription tools when an uncertainty zone or demonstrative phrase matters to the user's question. Claude reads the JPGs directly with its own vision; no OCR layer.
- **Shared video cache.** `~/.media-mcp/cache/videos/` keyed by sha256-of-URL, 24h TTL. A video fetched by `get_instagram_post` is reused by `get_video_frames_at` on a follow-up — no re-download.

### The thesis behind v1.1

Transcription is cheap; vision tokens are expensive. For 90% of video questions the transcript is enough. For the other 10% — install commands, URLs, handles, code snippets, unusual proper nouns, anything written on screen but not said aloud — Whisper will confidently give the wrong answer.

The LLM needs a way to know *when* its ears are insufficient. v1.1 gives it two signals: Whisper's own confidence (hard signal), and demonstrative phrases (soft signal). Both arrive with exact timestamps. The LLM's own vision handles the reading — no OCR seam.

Result: an agent that has ears on every video, eyes only where ears fail. Minimum frames, maximum accuracy.

## v1.2 — TikTok Support

Cobalt already handles TikTok with watermark removal, slideshow images, and original audio.

- `get_tiktok_video` — Download video by URL, return local path + transcription
- `get_tiktok_slides` — Download slideshow images to folder
- Automatic watermark-free downloads via Cobalt
- Whisper transcription for video audio

## v1.3 — Reddit and Bluesky

Both supported by Cobalt out of the box.

- `get_reddit_post` — Download Reddit video/GIF by URL with transcription
- `get_bluesky_post` — Fetch Bluesky post with media download and transcription

## v1.4 — Facebook, Pinterest, Snapchat

Cobalt covers all three.

- `get_facebook_video` — Download public Facebook videos
- `get_pinterest_media` — Download pins (photos, GIFs, videos, stories)
- `get_snapchat_spotlight` — Download Snapchat spotlights and stories

## v1.5 — Unified Media Pipeline

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

## v1.6 — Web Scraping via Firecrawl

Extend media-mcp beyond social media into any website. Self-hosted Firecrawl replaces Claude's limited built-in WebFetch with a proper web scraping engine.

- `scrape_url` — Fetch any webpage as clean LLM-ready markdown. Handles JS-rendered pages via Playwright. Returns full content, not a summary.
- `search_web` — Search the web and get full page content from results. Replaces the need for external search APIs.
- `crawl_site` — Crawl an entire website from a single URL. Returns all pages as markdown.
- `extract_data` — Extract structured JSON from any webpage using a schema. Uses local LLM (Ollama) or OpenAI.
- `scrape_pdf` — Convert web-hosted PDFs to markdown with table and formula preservation (Fire-PDF engine, Rust-based, 5x faster).

Firecrawl is open source (AGPL-3.0), self-hosted via Docker on the same server as Cobalt. No API key needed. Covers 96% of the web including JS-heavy SPAs.

Why this matters: social media tools fetch structured platform data, but research, competitive analysis, and documentation ingestion require general web access. Firecrawl gives AI agents the same quality of web data as a human with a browser.

## v1.7 — Streaming and Live Content

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
