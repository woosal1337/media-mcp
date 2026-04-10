<p align="center">
  <img src="assets/banner.png" alt="media-mcp — Social media at your fingertips, from your terminal" width="100%" />
</p>

<p align="center">
  MCP server for social media. Fetch tweets, transcribe videos, extract frames, and download Instagram posts — all from Claude Desktop, Claude Code, or any MCP client.
</p>

## What It Does

- **Twitter/X** — Fetch tweets, threads, articles, user profiles, followers, search, trends, bookmarks, and real-time monitoring
- **YouTube** — Get transcripts (captions or Whisper fallback)
- **Instagram** — Download posts, carousels, and reels with transcription (via Cobalt)
- **Video Frames** — Extract frames from any video URL at configurable FPS

Videos are automatically transcribed using local Whisper. No audio leaves your machine.

## Prerequisites

| Dependency | Required | What It Does | Install |
|---|---|---|---|
| [Node.js](https://nodejs.org/) 20+ | Yes | Runs the MCP server | `brew install node` or [nodejs.org](https://nodejs.org/) |
| [ffmpeg](https://ffmpeg.org/) | Yes | Audio extraction and frame extraction | `brew install ffmpeg` |
| [whisper-cli](https://github.com/ggerganov/whisper.cpp) | Yes | Local audio transcription | `brew install whisper-cpp` |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Yes | YouTube and social video downloads | `brew install yt-dlp` |
| [TwitterAPI.io](https://twitterapi.io/) key | Yes | Powers all Twitter/X tools | Sign up at [twitterapi.io](https://twitterapi.io/) |
| [Cobalt](https://github.com/imputnet/cobalt) instance | Optional | Instagram downloads (and 20 other platforms) | See [Cobalt Deployment](#cobalt-deployment) below |

## Quick Start

```bash
git clone https://github.com/woosal1337/media-mcp.git
cd media-mcp
npm install
npm run build
```

Download the Whisper base model:

```bash
mkdir -p models
curl -L -o models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Create your `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```
TWITTER_API_KEY=your_twitterapi_io_key_here
WHISPER_MODEL_PATH=/absolute/path/to/media-mcp/models/ggml-base.bin
COBALT_API_URL=http://localhost:9000
COBALT_API_KEY=your_cobalt_api_key_here
```

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "media-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/media-mcp/dist/index.js"],
      "env": {
        "TWITTER_API_KEY": "your_twitterapi_io_key",
        "WHISPER_MODEL_PATH": "/absolute/path/to/media-mcp/models/ggml-base.bin",
        "COBALT_API_URL": "http://localhost:9000",
        "COBALT_API_KEY": "your_cobalt_api_key"
      }
    }
  }
}
```

## Claude Code Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "media-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/media-mcp/dist/index.js"],
      "env": {
        "TWITTER_API_KEY": "your_twitterapi_io_key",
        "WHISPER_MODEL_PATH": "/absolute/path/to/media-mcp/models/ggml-base.bin",
        "COBALT_API_URL": "http://localhost:9000",
        "COBALT_API_KEY": "your_cobalt_api_key"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TWITTER_API_KEY` | Yes | API key from [twitterapi.io](https://twitterapi.io/) |
| `WHISPER_MODEL_PATH` | No | Path to Whisper model file (defaults to `./models/ggml-base.bin`) |
| `COBALT_API_URL` | No | URL of your Cobalt instance (required for Instagram tools) |
| `COBALT_API_KEY` | No | Cobalt API key if auth is enabled on your instance |

## Tools

### Twitter/X (26 tools)

| Tool | Description |
|---|---|
| `get_tweet` | Fetch a tweet by URL with text, media, metrics, threads, articles, and video transcription |
| `get_user_profile` | Fetch user bio, follower counts, verification status |
| `get_user_about` | Extended profile info beyond the basic profile |
| `get_user_tweets` | Recent tweets from a user (paginated) |
| `get_user_followers` | Followers of a user (paginated) |
| `get_user_following` | Accounts a user follows (paginated) |
| `get_user_mentions` | Tweets mentioning a user (paginated) |
| `get_verified_followers` | Verified (blue check) followers of a user |
| `check_follow_relationship` | Check if user A follows user B and vice versa |
| `search_tweets` | Advanced search with operators (`from:`, `to:`, `#hashtag`, `min_faves:`, date ranges) |
| `search_users` | Search for users by keyword |
| `get_tweet_replies` | Replies to a tweet (paginated) |
| `get_tweet_replies_v2` | Replies with sorting (Relevance, Latest, Likes) |
| `get_tweet_quotes` | Quote tweets of a tweet (paginated) |
| `get_tweet_retweeters` | Users who retweeted a tweet (paginated) |
| `get_trends` | Trending topics (worldwide or by location via WOEID) |
| `get_list_timeline` | Tweets from a Twitter list |
| `get_community_tweets` | Tweets from a Twitter community |
| `get_space_detail` | Twitter Space metadata |
| `monitor_user_add` | Start real-time monitoring of a user's tweets |
| `monitor_user_list` | List currently monitored users |
| `monitor_user_remove` | Stop monitoring a user |
| `filter_rule_add` | Add a keyword filter rule for real-time monitoring |
| `filter_rule_list` | List active filter rules |
| `filter_rule_delete` | Delete a filter rule |

### YouTube (1 tool)

| Tool | Description |
|---|---|
| `get_youtube_transcript` | Fetch video transcript — tries captions first (instant), falls back to yt-dlp + Whisper |

### Instagram (1 tool)

| Tool | Description |
|---|---|
| `get_instagram_post` | Download post media (images, videos, carousels) to local folder with optional transcription. Requires Cobalt. |

### Video (1 tool)

| Tool | Description |
|---|---|
| `extract_video_frames` | Extract frames from any video URL at configurable FPS with optional start/end times. Supports YouTube, Instagram, Twitter, TikTok, and direct video URLs. |

## How Transcription Works

1. Video is downloaded to a temp file
2. ffmpeg extracts audio as 16kHz mono WAV
3. whisper-cli transcribes locally using the Whisper model
4. Temp files are cleaned up automatically

For YouTube, captions are tried first (instant). Whisper is only used when no captions exist.

All transcription happens locally on your machine. No audio is sent to external services.

## Cobalt Deployment

[Cobalt](https://github.com/imputnet/cobalt) is an open-source media downloader that supports 21 platforms. media-mcp uses it for Instagram downloads. You need your own Cobalt instance — the public API requires JWT auth that doesn't work with server-to-server calls.

### Option 1: Docker (Recommended)

Create a directory and a `docker-compose.yml`:

```bash
mkdir cobalt && cd cobalt
```

```yaml
services:
  cobalt:
    image: ghcr.io/imputnet/cobalt:11
    init: true
    read_only: true
    restart: unless-stopped
    container_name: cobalt
    ports:
      - 9000:9000/tcp
    environment:
      API_URL: "http://localhost:9000/"
    labels:
      - com.centurylinklabs.watchtower.scope=cobalt

  watchtower:
    image: ghcr.io/containrrr/watchtower
    restart: unless-stopped
    command: --cleanup --scope cobalt --interval 900 --include-restarting
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Start it:

```bash
docker compose up -d
```

Verify it works:

```bash
curl http://localhost:9000/
```

You should get a JSON response with instance info.

### Adding API Key Authentication

Generate a key:

```bash
node -e "console.log(crypto.randomUUID())"
```

Create `keys.json`:

```json
{
  "your-generated-uuid-here": {
    "name": "media-mcp",
    "limit": "unlimited",
    "allowedServices": "all"
  }
}
```

Update `docker-compose.yml` to add auth:

```yaml
services:
  cobalt:
    image: ghcr.io/imputnet/cobalt:11
    init: true
    read_only: true
    restart: unless-stopped
    container_name: cobalt
    ports:
      - 9000:9000/tcp
    environment:
      API_URL: "http://localhost:9000/"
      API_KEY_URL: "file:///keys.json"
      API_AUTH_REQUIRED: 1
    volumes:
      - ./keys.json:/keys.json:ro
    labels:
      - com.centurylinklabs.watchtower.scope=cobalt

  watchtower:
    image: ghcr.io/containrrr/watchtower
    restart: unless-stopped
    command: --cleanup --scope cobalt --interval 900 --include-restarting
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Restart and test:

```bash
docker compose down && docker compose up -d
curl -H "Authorization: Api-Key your-generated-uuid-here" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json" \
     -d '{"url":"https://www.instagram.com/reel/EXAMPLE/"}' \
     http://localhost:9000/
```

### Adding Cookies (for Private Content)

Some Instagram content requires authentication. Create `cookies.json`:

```json
{
  "instagram.com": [
    {
      "name": "sessionid",
      "value": "your_session_id_here"
    }
  ]
}
```

Add to `docker-compose.yml` under cobalt environment:

```yaml
    environment:
      COOKIE_PATH: "/cookies.json"
    volumes:
      - ./cookies.json:/cookies.json:ro
```

### Option 2: Cloud Server

Deploy the same Docker setup on any VPS ($5/month on Hetzner, DigitalOcean, etc.):

1. SSH into your server
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Follow the Docker steps above
4. Set `COBALT_API_URL` to your server's IP: `http://your-server-ip:9000`
5. Consider adding a reverse proxy (nginx/Caddy) with SSL for production

### Production Hardening

```yaml
environment:
  CORS_WILDCARD: 0
  CORS_URL: "http://localhost"
  RATELIMIT_WINDOW: 60
  RATELIMIT_MAX: 100
  DURATION_LIMIT: 10800
```

### Cobalt Supported Platforms

Cobalt supports 21 platforms. Currently media-mcp uses it for Instagram. Future versions will add more:

YouTube, Instagram, TikTok, Twitter/X, Reddit, Facebook, Pinterest, Snapchat, Bluesky, Twitch, Vimeo, SoundCloud, Dailymotion, Tumblr, Bilibili, Loom, Streamable, Rutube, Newgrounds, OK.ru, VK.

## One-Command Setup with Claude Code

Copy the contents of [PROMPT.md](./PROMPT.md) and paste it into Claude Code. It will automatically install all prerequisites, clone the repo, configure everything, and connect media-mcp to your Claude Code instance.

## Development

```bash
npm run dev       # Watch mode (recompiles on change)
npm run build     # One-time build
npm start         # Run the server
```

## License

MIT
