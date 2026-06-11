import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "../src/http.js";

const FAST = { baseDelayMs: 1, maxDelayMs: 2 };

describe("fetchWithRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const response = await fetchWithRetry("https://example.com", undefined, { ...FAST, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on network errors and recovers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await fetchWithRetry("https://example.com", undefined, { ...FAST, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx and recovers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await fetchWithRetry("https://example.com", undefined, { ...FAST, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After on 429", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await fetchWithRetry("https://example.com", undefined, { ...FAST, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable client errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const response = await fetchWithRetry("https://example.com", undefined, { ...FAST, fetchImpl });
    expect(response.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the last response after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const response = await fetchWithRetry("https://example.com", undefined, {
      ...FAST,
      retries: 2,
      fetchImpl,
    });
    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries on persistent network failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      fetchWithRetry("https://example.com", undefined, { ...FAST, retries: 2, fetchImpl })
    ).rejects.toThrow("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("passes through init options", async () => {
    const fetchImpl = vi.fn(async (_input: any, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("k");
      return new Response("ok", { status: 200 });
    });
    await fetchWithRetry(
      "https://example.com",
      { method: "POST", headers: { "x-api-key": "k" } },
      { ...FAST, fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
