import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WHISPER_MODELS = [
  "tiny",
  "tiny.en",
  "base",
  "base.en",
  "small",
  "small.en",
  "medium",
  "medium.en",
  "large-v3",
  "large-v3-turbo",
] as const;

export type WhisperModel = (typeof WHISPER_MODELS)[number];

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export function isKnownModel(name: string): name is WhisperModel {
  return (WHISPER_MODELS as readonly string[]).includes(name);
}

export function modelFileName(name: WhisperModel): string {
  return `ggml-${name}.bin`;
}

export function modelUrl(name: WhisperModel): string {
  return `${HF_BASE}/${modelFileName(name)}`;
}

export function managedModelDir(): string {
  return process.env.MEDIA_MCP_MODEL_DIR ?? join(homedir(), ".media-mcp", "models");
}

function defaultModelPath(): string {
  return process.env.WHISPER_MODEL_PATH ?? join(__dirname, "..", "models", "ggml-base.bin");
}

async function downloadModel(name: WhisperModel): Promise<string> {
  const dir = managedModelDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, modelFileName(name));
  if (existsSync(dest)) return dest;

  const partPath = `${dest}.part`;
  const response = await fetchWithRetry(modelUrl(name), undefined, {
    timeoutMs: 1800000,
    retries: 2,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Whisper model '${name}': HTTP ${response.status}`);
  }
  try {
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(partPath));
    renameSync(partPath, dest);
  } catch (err) {
    try { if (existsSync(partPath)) unlinkSync(partPath); } catch { /* ignore */ }
    throw err;
  }
  return dest;
}

export async function resolveModelPath(model?: string): Promise<string> {
  if (!model) {
    const fallback = defaultModelPath();
    if (existsSync(fallback)) return fallback;
    return downloadModel("base");
  }

  if (!isKnownModel(model)) {
    if (model.includes("/") || model.endsWith(".bin")) return model;
    throw new Error(
      `Unknown Whisper model '${model}'. Known models: ${WHISPER_MODELS.join(", ")}. ` +
      `Alternatively pass an absolute path to a ggml .bin file.`
    );
  }

  const configured = defaultModelPath();
  if (configured.endsWith(modelFileName(model)) && existsSync(configured)) return configured;

  const managed = join(managedModelDir(), modelFileName(model));
  if (existsSync(managed)) return managed;

  return downloadModel(model);
}
