import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WHISPER_MODELS,
  isKnownModel,
  modelFileName,
  modelUrl,
  managedModelDir,
  resolveModelPath,
} from "../src/whisper-models.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "media-mcp-models-"));
  vi.stubEnv("MEDIA_MCP_MODEL_DIR", dir);
  vi.stubEnv("WHISPER_MODEL_PATH", join(dir, "nonexistent", "ggml-base.bin"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("model registry", () => {
  it("knows the standard whisper.cpp model names", () => {
    expect(isKnownModel("base")).toBe(true);
    expect(isKnownModel("large-v3-turbo")).toBe(true);
    expect(isKnownModel("gigantic")).toBe(false);
  });

  it("maps names to ggml filenames and HuggingFace URLs", () => {
    expect(modelFileName("small")).toBe("ggml-small.bin");
    expect(modelUrl("small")).toBe(
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
    );
    for (const model of WHISPER_MODELS) {
      expect(modelUrl(model)).toMatch(/^https:\/\/huggingface\.co\/.+\.bin$/);
    }
  });

  it("respects MEDIA_MCP_MODEL_DIR for the managed directory", () => {
    expect(managedModelDir()).toBe(dir);
  });
});

describe("resolveModelPath", () => {
  it("passes through explicit .bin paths untouched", async () => {
    await expect(resolveModelPath("/opt/models/ggml-custom.bin")).resolves.toBe(
      "/opt/models/ggml-custom.bin"
    );
    await expect(resolveModelPath("models/ggml-base.bin")).resolves.toBe("models/ggml-base.bin");
  });

  it("rejects unknown model names with the list of valid ones", async () => {
    await expect(resolveModelPath("gigantic")).rejects.toThrow(/Unknown Whisper model 'gigantic'/);
    await expect(resolveModelPath("gigantic")).rejects.toThrow(/large-v3-turbo/);
  });

  it("uses WHISPER_MODEL_PATH when it matches the requested model", async () => {
    const configured = join(dir, "ggml-small.bin");
    writeFileSync(configured, "stub");
    vi.stubEnv("WHISPER_MODEL_PATH", configured);
    await expect(resolveModelPath("small")).resolves.toBe(configured);
  });

  it("returns an already-downloaded managed model without fetching", async () => {
    writeFileSync(join(dir, "ggml-tiny.bin"), "stub");
    await expect(resolveModelPath("tiny")).resolves.toBe(join(dir, "ggml-tiny.bin"));
  });

  it("falls back to WHISPER_MODEL_PATH when no model is requested and the file exists", async () => {
    const configured = join(dir, "ggml-base.bin");
    writeFileSync(configured, "stub");
    vi.stubEnv("WHISPER_MODEL_PATH", configured);
    await expect(resolveModelPath()).resolves.toBe(configured);
  });
});
