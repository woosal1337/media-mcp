---
name: media-mcp
description: Social media at your fingertips. Fetch tweets, transcribe videos, extract frames, download Instagram posts — from any MCP client. 29 tools across Twitter/X, YouTube, Instagram, and video processing. All transcription runs locally via Whisper. No data leaves your machine.
---

# Media MCP

## Principle

1. **Fetch structured data, not raw HTML.** Every tool calls a purpose-built API (TwitterAPI.io, Cobalt, YouTube captions) and returns structured, LLM-ready text. No scraping, no DOM parsing, no fragile selectors.
2. **Transcribe locally, always.** Audio never leaves the machine. Whisper runs on local hardware against a local model file. The only network calls are to download the media itself.
3. **Captions first, Whisper second.** For YouTube, try platform captions (instant, free, accurate). Fall back to download + Whisper only when captions don't exist. Don't burn API time or compute when the platform already did the work.
4. **Download then process.** Media is downloaded to a temp file, processed (transcribed, frame-extracted), and cleaned up. No streaming pipelines, no partial results. The user gets complete output or a clear error.
5. **One tool, one job.** Each tool does exactly one thing. `get_tweet` fetches a tweet. `get_youtube_transcript` gets a transcript. `extract_video_frames` pulls frames. No multi-purpose tools, no mode flags that change behavior.
6. **Return file paths for visual content.** When downloading images or extracting frames, return absolute local paths so the LLM can read them directly with its vision capabilities. Don't describe images — let the model see them.

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │              MCP Client                   │
                    │   (Claude Desktop / Claude Code / etc.)   │
                    └──────────────┬───────────────────────────┘
                                   │ stdio
                    ┌──────────────▼───────────────────────────┐
                    │           media-mcp server                │
                    │         (Node.js, MCP SDK)                │
                    └──┬────────┬────────┬────────┬────────────┘
                       │        │        │        │
              ┌────────▼──┐ ┌──▼────┐ ┌─▼─────┐ ┌▼──────────┐
              │ Twitter/X  │ │YouTube│ │Insta- │ │  Video     │
              │ 26 tools   │ │1 tool │ │gram   │ │  Frames    │
              │            │ │       │ │1 tool │ │  1 tool    │
              └────┬───────┘ └──┬────┘ └──┬────┘ └─────┬──────┘
                   │            │         │            │
          ┌────────▼──┐   ┌────▼───┐  ┌──▼─────┐  ┌───▼─────┐
          │TwitterAPI  │   │yt-dlp  │  │ Cobalt │  │ yt-dlp  │
          │   .io      │   │caption │  │  API   │  │ direct  │
          │  (REST)    │   │  API   │  │(self-  │  │  fetch  │
          └────────────┘   └───┬────┘  │hosted) │  └────┬────┘
                               │       └───┬────┘       │
                               ▼           ▼            ▼
                         ┌─────────────────────────────────┐
                         │     Local Processing Pipeline    │
                         │                                  │
                         │  ffmpeg ──► audio extraction     │
                         │  whisper-cli ──► transcription   │
                         │  ffmpeg ──► frame extraction     │
                         │                                  │
                         │  All temp files cleaned up       │
                         └─────────────────────────────────┘
```

## Pipelines

Each tool follows a specific pipeline. Understanding what happens at each step helps you predict latency and failure modes.

### Tweet Fetch Pipeline

```
URL ──► TwitterAPI.io REST ──► parse tweet JSON ──► extract media URLs
                                                         │
                                          ┌──────────────┤
                                          ▼              ▼
                                       [photo]        [video]
                                     return URL    download ──► ffmpeg ──► whisper-cli
                                                                              │
                                                                     return text + metrics
```

**What it does:** Fetches tweet text, author info, metrics (likes/RT/views), media URLs, threads, quoted tweets, and articles via REST API. If the tweet contains video and `transcribe: true`, downloads the video to a temp file, extracts audio with ffmpeg (16kHz mono WAV), transcribes with whisper-cli, then cleans up.

**Latency:** ~1s for text-only tweets. ~10-30s when video transcription is involved (download + ffmpeg + Whisper).

### YouTube Transcript Pipeline

```
URL ──► extract video ID
             │
             ├──► try captions API (instant, ~200ms)
             │         │
             │    success? ──► return timestamped segments
             │         │
             │    fail? ──► yt-dlp download ──► ffmpeg extract audio ──► whisper-cli
             │                                                              │
             │                                                     return full transcript
             ▼
        return text + segments + source indicator
```

**What it does:** First tries YouTube's built-in caption system (free, instant, accurate). If no captions exist, falls back to downloading audio with yt-dlp, extracting with ffmpeg, and transcribing with whisper-cli.

**Latency:** ~200ms with captions. ~20-60s with Whisper fallback (depends on video length).

### Instagram Download Pipeline

```
URL ──► Cobalt API ──► get download URLs + metadata
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
           [single]    [carousel]   [video/reel]
          download     download     download ──► ffmpeg ──► whisper-cli
          to folder    all items                                │
                       to folder              return paths + transcription
                │           │
           return local file paths (absolute)
```

**What it does:** Sends the Instagram URL to your self-hosted Cobalt instance. Cobalt returns download URLs for all media items. Each item is downloaded to a local folder with a unique ID. Videos are optionally transcribed with Whisper. Returns absolute file paths so the LLM can view images directly.

**Requires:** Self-hosted Cobalt instance (`COBALT_API_URL`).

### Video Frame Extraction Pipeline

```
URL ──► detect source type
             │
             ├──► [direct URL] ──► HTTP download to temp
             ├──► [YouTube/TikTok/etc.] ──► yt-dlp download to temp
             │
             ▼
        ffmpeg -i <video> -vf fps=<rate> -ss <start> -to <end> frame_%04d.jpg
             │
             ▼
        return folder path + frame paths + timestamps
```

**What it does:** Downloads video from any supported URL, then uses ffmpeg to extract frames at a configurable rate (default: 1 fps). Supports time range extraction with start/end parameters. Returns absolute paths to frame images so the LLM can analyze them visually.

**Latency:** ~5-30s depending on video length and frame rate.

## Tool Reference

### Twitter/X — 26 tools

All Twitter tools call the TwitterAPI.io REST API. Requires `TWITTER_API_KEY`.

#### Fetching tweets

| Tool | What it does | Returns |
|---|---|---|
| `get_tweet` | **Fetches** a single tweet by URL. Parses text, author, metrics, media, threads, quoted tweets, articles. **Transcribes** video if present. | Text + metrics + media URLs + transcription |
| `get_user_tweets` | **Fetches** recent tweets from a user (paginated, 20/page) | Tweet list with text + metrics |
| `search_tweets` | **Searches** tweets with advanced query operators (`from:`, `to:`, `#hashtag`, `min_faves:`, date ranges) | Tweet list with text + metrics |
| `get_tweet_replies` | **Fetches** replies to a tweet (paginated, 20/page) | Reply list with authors + text |
| `get_tweet_replies_v2` | **Fetches** replies with sorting (Relevance, Latest, Likes) | Sorted reply list |
| `get_tweet_quotes` | **Fetches** quote tweets of a tweet (paginated, 20/page) | Quote tweet list |
| `get_tweet_retweeters` | **Fetches** users who retweeted a tweet (paginated, 100/page) | User list |
| `get_list_timeline` | **Fetches** tweets from a Twitter list | Tweet list |
| `get_community_tweets` | **Fetches** tweets from a Twitter community | Tweet list |
| `get_trends` | **Fetches** trending topics (worldwide or by WOEID location) | Trend list with tweet volumes |

#### Fetching profiles

| Tool | What it does | Returns |
|---|---|---|
| `get_user_profile` | **Fetches** user bio, follower counts, verification, location, website | Profile data |
| `get_user_about` | **Fetches** extended profile info beyond basic profile | Extended profile JSON |
| `get_user_followers` | **Fetches** followers of a user (paginated, 200/page) | User list with bios |
| `get_user_following` | **Fetches** accounts a user follows (paginated, 200/page) | User list |
| `get_user_mentions` | **Fetches** tweets mentioning a user (paginated, 20/page) | Tweet list |
| `get_verified_followers` | **Fetches** verified (blue check) followers (paginated, 20/page) | Verified user list |
| `search_users` | **Searches** for users by keyword | User list with bios |
| `check_follow_relationship` | **Checks** if user A follows user B and vice versa | Boolean pair |
| `get_space_detail` | **Fetches** Twitter Space metadata (title, host, speakers, state) | Space JSON |

#### Real-time monitoring

| Tool | What it does | Returns |
|---|---|---|
| `monitor_user_add` | **Starts** real-time monitoring of a user's tweets | Confirmation |
| `monitor_user_list` | **Lists** all currently monitored users | Monitored user list |
| `monitor_user_remove` | **Stops** monitoring a user | Confirmation |
| `filter_rule_add` | **Creates** a keyword filter rule for real-time monitoring | Rule confirmation |
| `filter_rule_list` | **Lists** all active filter rules | Rule list |
| `filter_rule_delete` | **Deletes** a filter rule | Confirmation |

### YouTube — 1 tool

| Tool | What it does | Returns |
|---|---|---|
| `get_youtube_transcript` | **Fetches** video transcript. Tries captions first (instant). **Falls back** to yt-dlp download + ffmpeg audio extraction + **Whisper transcription** if no captions. | Full text + timestamped segments + source indicator |

### Instagram — 1 tool

Requires self-hosted Cobalt instance (`COBALT_API_URL`).

| Tool | What it does | Returns |
|---|---|---|
| `get_instagram_post` | **Downloads** post media (images, videos, carousels) to local folder via Cobalt. **Transcribes** video audio with Whisper. | Local file paths + transcription |

### Video — 1 tool

| Tool | What it does | Returns |
|---|---|---|
| `extract_video_frames` | **Downloads** video from any URL (YouTube, Instagram, Twitter, TikTok, direct). **Extracts** frames at configurable FPS with optional time range via ffmpeg. | Local frame paths + timestamps |

## Dependencies

| Component | Role | Required |
|---|---|---|
| Node.js 20+ | Runs the MCP server | Yes |
| ffmpeg | Audio extraction (transcription pipeline) and frame extraction | Yes |
| whisper-cli | Local audio-to-text transcription | Yes |
| yt-dlp | Video download from YouTube and other platforms | Yes |
| TwitterAPI.io key | Powers all 26 Twitter/X tools | Yes |
| Cobalt instance | Instagram media downloads | Only for Instagram |

## How Transcription Works

1. Video is downloaded to a temp file (via direct HTTP, yt-dlp, or Cobalt)
2. ffmpeg extracts audio as 16kHz mono WAV: `ffmpeg -i video.mp4 -ar 16000 -ac 1 -f wav audio.wav`
3. whisper-cli transcribes locally: `whisper-cli -m <model> -f audio.wav --no-timestamps`
4. Temp files (video + audio) are cleaned up automatically

All transcription happens on your machine. No audio is sent to external services.

## Anti-patterns

- **Calling `get_tweet` in a loop for bulk data.** Use `get_user_tweets` or `search_tweets` instead — they return 20 results per call.
- **Using `extract_video_frames` at high FPS for long videos.** 1 fps on a 10-minute video = 600 frames. Use time ranges (`start`/`end`) to focus on the relevant section.
- **Assuming Instagram tools work without Cobalt.** They don't. The tool will return a clear error, but check `COBALT_API_URL` is set before attempting.
- **Re-transcribing the same video.** Transcription is the slowest operation (~10-30s). If you need the same transcript again, cache the result in your conversation.
- **Fetching profiles to get tweet content.** `get_user_profile` returns bio data, not tweets. Use `get_user_tweets` for tweet content.
- **Using `search_tweets` without operators.** Raw keyword search returns noisy results. Use `from:user`, `min_faves:100`, date ranges, etc. for precision.
