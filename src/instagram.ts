import { execFile } from "node:child_process";
import { createWriteStream, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { transcribe, renderTranscript } from "./transcribe.js";
import { cacheVideo } from "./video-cache.js";

const COBALT_API_URL = process.env.COBALT_API_URL;
const COBALT_API_KEY = process.env.COBALT_API_KEY;

export interface MediaItem {
  type: "photo" | "video" | "gif";
  url: string;
  localPath?: string;
  thumb?: string;
}

export interface InstagramPost {
  url: string;
  mediaFolder?: string;
  media: MediaItem[];
  audioUrl?: string;
  filename?: string;
  videoTranscription?: string;
  isCarousel: boolean;
}

export function isInstagramUrl(input: string): boolean {
  return /(?:instagram\.com|instagr\.am)\/(p|reel|reels|tv)\/[\w-]+/i.test(input);
}

function normalizeUrl(input: string): string {
  const match = input.match(
    /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(p|reel|reels|tv)\/([\w-]+)/i
  );
  if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  throw new Error(`Cannot parse Instagram URL: ${input}`);
}

interface CobaltPickerItem {
  url: string;
  type: string;
  thumb?: string;
}

interface CobaltResponse {
  status: "tunnel" | "redirect" | "picker" | "local-processing" | "error";
  url?: string;
  filename?: string;
  audio?: string;
  picker?: CobaltPickerItem[];
  error?: { code: string };
}

async function fetchCobaltUrl(url: string): Promise<CobaltResponse> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (COBALT_API_KEY) {
    headers["Authorization"] = `Api-Key ${COBALT_API_KEY}`;
  }

  const response = await fetch(`${COBALT_API_URL}/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      videoQuality: "1080",
      filenameStyle: "basic",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cobalt API returned ${response.status}: ${text}`);
  }

  return (await response.json()) as CobaltResponse;
}

function guessExtension(url: string): string {
  if (url.includes(".mp4")) return "mp4";
  if (url.includes(".webp")) return "webp";
  if (url.includes(".jpg") || url.includes("dst-jpg")) return "jpg";
  if (url.includes(".png")) return "png";
  if (url.includes(".gif")) return "gif";
  return "jpg";
}

async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download file: ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body as any);
  const fileStream = createWriteStream(filePath);
  await pipeline(nodeStream, fileStream);
}

async function downloadAllMedia(
  items: MediaItem[],
  folderPath: string
): Promise<void> {
  mkdirSync(folderPath, { recursive: true });

  const downloads = items.map(async (item, index) => {
    const ext = guessExtension(item.url);
    const filename = `${index + 1}.${ext}`;
    const filePath = join(folderPath, filename);
    try {
      await downloadFile(item.url, filePath);
      item.localPath = filePath;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      item.localPath = `[Download failed: ${message}]`;
    }
  });

  await Promise.all(downloads);
}

function extractAudio(videoPath: string): Promise<string> {
  const audioPath = join(tmpdir(), `media-mcp-ig-${randomUUID()}.wav`);
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-i", videoPath,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        "-y",
        audioPath,
      ],
      { timeout: 120000 },
      (error) => {
        if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
        else resolve(audioPath);
      }
    );
  });
}

function cleanup(...paths: string[]) {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

async function transcribeVideo(
  videoPath: string,
  modelPath: string
): Promise<string> {
  let audioPath = "";
  try {
    audioPath = await extractAudio(videoPath);
    const result = await transcribe(audioPath, modelPath);
    return renderTranscript(result);
  } finally {
    cleanup(audioPath);
  }
}

export async function fetchInstagramPost(
  input: string,
  modelPath?: string,
  transcribe: boolean = true
): Promise<InstagramPost> {
  if (!COBALT_API_URL) {
    throw new Error("COBALT_API_URL environment variable is required for Instagram support");
  }

  const url = normalizeUrl(input);
  const cobalt = await fetchCobaltUrl(url);

  if (cobalt.status === "error") {
    throw new Error(
      `Cobalt could not process this URL: ${cobalt.error?.code ?? "unknown error"}`
    );
  }

  const folderId = randomUUID();
  const mediaFolder = join(tmpdir(), `media-mcp-ig-${folderId}`);
  const media: MediaItem[] = [];
  let isCarousel = false;

  if (cobalt.status === "picker" && cobalt.picker && cobalt.picker.length > 0) {
    isCarousel = true;
    for (const item of cobalt.picker) {
      media.push({
        type: (item.type as "photo" | "video" | "gif") ?? "photo",
        url: item.url,
        thumb: item.thumb,
      });
    }
  } else if (cobalt.status === "tunnel" || cobalt.status === "redirect") {
    const url = cobalt.url!;
    const isVideo = url.includes(".mp4") || url.includes("video");
    media.push({
      type: isVideo ? "video" : "photo",
      url,
    });
  }

  if (media.length > 0) {
    await downloadAllMedia(media, mediaFolder);
  }

  const post: InstagramPost = {
    url,
    mediaFolder,
    media,
    audioUrl: cobalt.audio,
    filename: cobalt.filename,
    isCarousel,
  };

  const firstVideo = media.find(
    (m) => m.type === "video" && m.localPath && !m.localPath.startsWith("[")
  );
  if (firstVideo?.localPath) {
    try { cacheVideo(url, firstVideo.localPath); } catch { /* best effort */ }
  }

  if (transcribe && modelPath) {
    const videoItems = media.filter(
      (m) => m.type === "video" && m.localPath && !m.localPath.startsWith("[")
    );
    if (videoItems.length > 0) {
      const transcriptions: string[] = [];
      for (const video of videoItems) {
        try {
          const text = await transcribeVideo(video.localPath!, modelPath);
          transcriptions.push(text);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          transcriptions.push(`[Transcription failed: ${message}]`);
        }
      }
      post.videoTranscription = transcriptions.join("\n\n---\n\n");
    }
  }

  return post;
}
