import { execFile } from "node:child_process";
import { createWriteStream, unlinkSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface FrameExtractionResult {
  folder: string;
  frames: string[];
  frameCount: number;
  fps: number;
  startSec?: number;
  endSec?: number;
  videoDuration?: number;
}

export async function downloadVideoToTemp(url: string): Promise<string> {
  const filePath = join(tmpdir(), `media-mcp-vid-${randomUUID()}.mp4`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body as any);
  const fileStream = createWriteStream(filePath);
  await pipeline(nodeStream, fileStream);
  return filePath;
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`ffprobe failed: ${error.message}\n${stderr}`));
        else {
          const duration = parseFloat(stdout.trim());
          if (isNaN(duration)) reject(new Error("Could not parse video duration"));
          else resolve(duration);
        }
      }
    );
  });
}

function extractFramesWithFfmpeg(
  videoPath: string,
  outputFolder: string,
  fps: number,
  startSec?: number,
  endSec?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = [];

    if (startSec !== undefined && startSec > 0) {
      args.push("-ss", startSec.toString());
    }

    args.push("-i", videoPath);

    if (endSec !== undefined) {
      const duration = startSec !== undefined ? endSec - startSec : endSec;
      if (duration > 0) {
        args.push("-t", duration.toString());
      }
    }

    args.push(
      "-vf", `fps=${fps}`,
      "-q:v", "2",
      "-frame_pts", "1",
      join(outputFolder, "frame_%04d.jpg")
    );

    execFile("ffmpeg", args, { timeout: 300000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`ffmpeg frame extraction failed: ${error.message}\n${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

export function downloadVideoWithYtDlp(url: string): Promise<string> {
  const videoPath = join(tmpdir(), `media-mcp-vid-${randomUUID()}.mp4`);
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "-f", "best[ext=mp4]/best",
        "-o", videoPath,
        "--no-playlist",
        "--no-check-certificates",
        url,
      ],
      { timeout: 300000 },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`yt-dlp failed: ${error.message}\n${stderr}`));
        else resolve(videoPath);
      }
    );
  });
}

function cleanup(...paths: string[]) {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

export async function extractFrames(
  videoUrl: string,
  fps: number = 1,
  startSec?: number,
  endSec?: number,
  useYtDlp?: boolean
): Promise<FrameExtractionResult> {
  const folderId = randomUUID();
  const outputFolder = join(tmpdir(), `media-mcp-frames-${folderId}`);
  mkdirSync(outputFolder, { recursive: true });

  const needsYtDlp = useYtDlp ?? /(?:youtube\.com|youtu\.be|instagram\.com|twitter\.com|x\.com|tiktok\.com|reddit\.com|vimeo\.com)/.test(videoUrl);

  let videoPath = "";
  try {
    if (needsYtDlp) {
      videoPath = await downloadVideoWithYtDlp(videoUrl);
    } else {
      videoPath = await downloadVideoToTemp(videoUrl);
    }

    const duration = await getVideoDuration(videoPath);

    const effectiveStart = startSec !== undefined ? Math.max(0, Math.min(startSec, duration)) : undefined;
    const effectiveEnd = endSec !== undefined ? Math.max(0, Math.min(endSec, duration)) : undefined;

    if (effectiveStart !== undefined && effectiveEnd !== undefined && effectiveStart >= effectiveEnd) {
      throw new Error(`Start time (${effectiveStart}s) must be before end time (${effectiveEnd}s)`);
    }

    await extractFramesWithFfmpeg(videoPath, outputFolder, fps, effectiveStart, effectiveEnd);

    const frames = readdirSync(outputFolder)
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f) => join(outputFolder, f));

    return {
      folder: outputFolder,
      frames,
      frameCount: frames.length,
      fps,
      startSec: effectiveStart,
      endSec: effectiveEnd,
      videoDuration: duration,
    };
  } finally {
    cleanup(videoPath);
  }
}
