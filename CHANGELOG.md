# Changelog

All notable changes to media-mcp are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-06-11

### Added

- Vitest unit test suite covering the confidence pipeline (whisper JSON parsing, uncertainty-zone merging, demonstrative-phrase detection, marker rendering), URL extraction for Twitter/YouTube/Instagram, retry behavior, model resolution, and the video cache.
- GitHub Actions CI: build + tests on Node 20 and 22 for every push and pull request.
- Shared HTTP retry layer: exponential backoff with jitter, `Retry-After` support on 429, retries on 408/429/5xx and network errors, per-call timeouts. Applied to all TwitterAPI.io, Cobalt, Cloudflare, and media download calls.
- `language` parameter on `get_tweet`, `get_youtube_transcript`, and `get_instagram_post`: any ISO 639-1 code or `auto`. YouTube captions are requested in the chosen language before falling back to Whisper.
- `model` parameter on the same tools: `tiny` through `large-v3-turbo`, downloaded from HuggingFace on first use into `~/.media-mcp/models` (override with `MEDIA_MCP_MODEL_DIR`), or an absolute path to a ggml `.bin` file.
- Automatic fallback model download: if no `WHISPER_MODEL_PATH` is configured and no local model exists, the base model is fetched on first transcription.
- `MEDIA_MCP_CACHE_DIR` environment variable to relocate the video cache.
- npm package with a `media-mcp` bin: `npx media-mcp` now works without cloning.
- Release automation: tag-triggered npm publish with provenance, GitHub Release notes, and a Docker image pushed to GHCR.
- Dockerfile bundling ffmpeg, yt-dlp, and a statically built whisper-cli, with models and cache on a `/data` volume.

### Changed

- The MCP server now reports its real version from package.json instead of a hardcoded string.

## [1.1.0] - 2026-04-20

### Added

- Per-token Whisper confidence via `whisper-cli -ojf`, with inline `⟨token p=0.XX⟩` markers.
- Uncertainty zones: contiguous low-confidence spans merged within 150ms, reported with `midpoint_s` timestamps.
- Demonstrative-phrase detection ("visit our", "this command", "in the bio") signaling on-screen content.
- `get_video_frames_at`: precision frame extraction, one JPG per timestamp.
- Shared 24h video cache keyed by sha256 of URL, reused across transcription and frame tools.

## [1.0.0] - 2026-04-10

### Added

- Initial release: 28 tools across Twitter/X, YouTube, and Instagram with local Whisper transcription, frame extraction, and Cloudflare markdown fetch following in 1.0.x.
