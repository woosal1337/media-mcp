# media-mcp — Claude Code Installation Prompt

Copy everything below this line and paste it into Claude Code. It will install all dependencies, clone the repo, download the Whisper model, and configure Claude Code to use media-mcp automatically.

---

I need you to install and configure the media-mcp MCP server on my machine. This is a social media MCP server that gives you tools to fetch tweets, transcribe videos, extract frames, and download Instagram posts. Follow every step below exactly.

## Step 1: Check and install system dependencies

Check if each of these is installed. If missing, install it using Homebrew (macOS) or the appropriate package manager:

- **Node.js 20+** — run `node --version`. If missing or below 20: `brew install node`
- **ffmpeg** — run `ffmpeg -version`. If missing: `brew install ffmpeg`
- **whisper-cli** (whisper.cpp) — run `whisper-cli --help`. If missing: `brew install whisper-cpp`
- **yt-dlp** — run `yt-dlp --version`. If missing: `brew install yt-dlp`

If Homebrew itself is not installed, install it first: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

Report which dependencies were already installed and which you had to install.

## Step 2: Clone and build media-mcp

```bash
cd ~/Documents
git clone https://github.com/woosal1337/media-mcp.git
cd media-mcp
npm install
npm run build
```

If `~/Documents` doesn't exist or you prefer a different location, use `~/` instead. Remember the absolute path — you'll need it for configuration.

## Step 3: Download Whisper model

```bash
cd ~/Documents/media-mcp
mkdir -p models
curl -L -o models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

This downloads the Whisper base model (~148MB). Wait for it to complete fully.

## Step 4: Create .env file

```bash
cp .env.example .env
```

Now ask me for my API keys. I need to provide:

1. **TWITTER_API_KEY** — from twitterapi.io (required for all Twitter tools)
2. **COBALT_API_URL** — URL of my Cobalt instance (optional, needed for Instagram tools)
3. **COBALT_API_KEY** — Cobalt API key (optional, only if my Cobalt instance has auth enabled)

Set `WHISPER_MODEL_PATH` to the absolute path: `~/Documents/media-mcp/models/ggml-base.bin` (expand the `~` to the full home directory path).

Write the values to `.env`. If I don't have a Cobalt instance, skip those variables — Instagram tools will show a clear error message explaining Cobalt is needed.

## Step 5: Configure Claude Code

Read my existing `~/.claude/settings.json` file. If it doesn't exist, create it. If it exists, preserve all existing settings and merge the new MCP server into the `mcpServers` object.

Add this entry to `mcpServers` (replace paths with the actual absolute paths on my machine):

```json
{
  "mcpServers": {
    "media-mcp": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO/media-mcp/dist/index.js"],
      "env": {
        "TWITTER_API_KEY": "THE_KEY_I_PROVIDED",
        "WHISPER_MODEL_PATH": "ABSOLUTE_PATH_TO/media-mcp/models/ggml-base.bin"
      }
    }
  }
}
```

Include `COBALT_API_URL` and `COBALT_API_KEY` in the env block only if I provided them.

## Step 6: Verify the installation

Run a quick build check:

```bash
cd ~/Documents/media-mcp
npm run build
```

If it compiles with no errors, the installation is complete.

## Step 7: Test the connection

Tell me to restart Claude Code (or open a new session) so the MCP server loads. After restart, the following tools will be available:

**Twitter/X (26 tools):** get_tweet, get_user_profile, get_user_about, get_user_tweets, get_user_followers, get_user_following, get_user_mentions, get_verified_followers, check_follow_relationship, search_tweets, search_users, get_tweet_replies, get_tweet_replies_v2, get_tweet_quotes, get_tweet_retweeters, get_trends, get_list_timeline, get_community_tweets, get_space_detail, monitor_user_add, monitor_user_list, monitor_user_remove, filter_rule_add, filter_rule_list, filter_rule_delete

**YouTube (1 tool):** get_youtube_transcript

**Instagram (1 tool):** get_instagram_post (requires Cobalt)

**Video (2 tools):** extract_video_frames, get_video_frames_at

**Cloudflare (1 tool):** fetch_markdown (requires Cloudflare Browser Run keys)

All three transcription tools (`get_tweet`, `get_youtube_transcript`, `get_instagram_post`) emit per-token Whisper confidence alongside the transcript. When the transcript flags **Uncertainty zones** or **Demonstrative phrases**, follow up with `get_video_frames_at` at those exact timestamps — you read the JPGs directly with vision and recover the on-screen text that transcription missed. Video downloads are cached at `~/.media-mcp/cache/videos/` so the follow-up call never re-downloads.

## Optional: Deploy Cobalt for Instagram support

If I want Instagram support, help me deploy a Cobalt instance:

1. Check if Docker is installed: `docker --version`. If missing, tell me to install Docker Desktop from docker.com
2. Create a cobalt directory: `mkdir -p ~/cobalt && cd ~/cobalt`
3. Create `docker-compose.yml` with the Cobalt image (ghcr.io/imputnet/cobalt:11) on port 9000
4. Generate an API key: `node -e "console.log(crypto.randomUUID())"`
5. Create `keys.json` with the generated key
6. Start with `docker compose up -d`
7. Verify with `curl http://localhost:9000/`
8. Update my `.env` and Claude Code settings with `COBALT_API_URL=http://localhost:9000` and `COBALT_API_KEY=the-generated-key`

## Error handling

If any step fails:
- Read the error message carefully
- Check if it's a missing dependency, permission issue, or network problem
- Fix the root cause before proceeding to the next step
- Never skip a step — each one depends on the previous

If `npm run build` fails with TypeScript errors, the source code may need updating. Run `git pull` to get the latest version and try again.

If whisper-cli is not found after installation, check if it's installed as `whisper` instead of `whisper-cli` and let me know — the binary name varies by installation method.
