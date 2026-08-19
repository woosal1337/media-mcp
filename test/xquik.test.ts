import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tweetFromXquik, twitterBackend, type XquikTweet } from "../src/twitter.js";

const ENV_KEYS = ["TWITTER_BACKEND", "TWITTER_API_KEY", "XQUIK_API_KEY"] as const;

describe("twitterBackend", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults to twitterapi", () => {
    expect(twitterBackend()).toBe("twitterapi");
  });

  it("uses xquik when TWITTER_BACKEND says so, in any case", () => {
    process.env.TWITTER_BACKEND = "XQuik";
    expect(twitterBackend()).toBe("xquik");
  });

  it("falls back to xquik when only XQUIK_API_KEY is set", () => {
    process.env.XQUIK_API_KEY = "xq_test";
    expect(twitterBackend()).toBe("xquik");
  });

  it("keeps twitterapi when both keys are set and no backend is named", () => {
    process.env.TWITTER_API_KEY = "ta_test";
    process.env.XQUIK_API_KEY = "xq_test";
    expect(twitterBackend()).toBe("twitterapi");
  });
});

describe("tweetFromXquik", () => {
  const base: XquikTweet = {
    id: "1234567890",
    url: "https://x.com/woosal1337/status/1234567890",
    text: "hello",
    createdAt: "2026-08-19T00:00:00Z",
    likeCount: 5,
    retweetCount: 2,
    replyCount: 1,
    viewCount: 900,
    bookmarkCount: 3,
    lang: "en",
    author: { username: "woosal1337", name: "Ege", followers: 100 },
  };

  it("maps the scalar fields and the author", () => {
    const tweet = tweetFromXquik(base);
    expect(tweet.id).toBe("1234567890");
    expect(tweet.text).toBe("hello");
    expect(tweet.likeCount).toBe(5);
    expect(tweet.author.userName).toBe("woosal1337");
    expect(tweet.author.followers).toBe(100);
  });

  it("builds a URL from the ID when Xquik omits one", () => {
    const tweet = tweetFromXquik({ ...base, url: undefined });
    expect(tweet.url).toBe("https://x.com/i/status/1234567890");
  });

  it("takes the author from the second argument when the tweet has none", () => {
    const tweet = tweetFromXquik({ ...base, author: undefined }, { username: "kriptoburak", name: "Burak" });
    expect(tweet.author.userName).toBe("kriptoburak");
  });

  // The mapping dropped videoVariants and durationMillis before, so
  // processMedia could never set videoUrl and transcription never ran.
  it("maps videoVariants and durationMillis onto video_info", () => {
    const tweet = tweetFromXquik({
      ...base,
      media: [{
        type: "video",
        mediaUrl: "https://pbs.twimg.com/thumb.jpg",
        durationMillis: 30000,
        videoVariants: [
          { bitrate: 832000, contentType: "video/mp4", url: "https://video.twimg.com/low.mp4" },
          { bitrate: 2176000, contentType: "video/mp4", url: "https://video.twimg.com/high.mp4" },
        ],
      }],
    });

    const media = tweet.extendedEntities?.media?.[0];
    expect(media?.type).toBe("video");
    expect(media?.media_url_https).toBe("https://pbs.twimg.com/thumb.jpg");
    expect(media?.video_info?.duration_millis).toBe(30000);
    expect(media?.video_info?.variants).toHaveLength(2);
    expect(media?.video_info?.variants[1].url).toBe("https://video.twimg.com/high.mp4");
    expect(media?.video_info?.variants[1].content_type).toBe("video/mp4");
  });

  it("treats animated_gif as video so its variants survive", () => {
    const tweet = tweetFromXquik({
      ...base,
      media: [{
        type: "animated_gif",
        mediaUrl: "https://pbs.twimg.com/gif.jpg",
        videoVariants: [{ contentType: "video/mp4", url: "https://video.twimg.com/gif.mp4" }],
      }],
    });

    const media = tweet.extendedEntities?.media?.[0];
    expect(media?.type).toBe("video");
    expect(media?.video_info?.variants[0].url).toBe("https://video.twimg.com/gif.mp4");
  });

  it("drops variants that carry no URL", () => {
    const tweet = tweetFromXquik({
      ...base,
      media: [{
        type: "video",
        mediaUrl: "https://pbs.twimg.com/thumb.jpg",
        videoVariants: [{ contentType: "video/mp4" }, { contentType: "video/mp4", url: "https://video.twimg.com/ok.mp4" }],
      }],
    });

    expect(tweet.extendedEntities?.media?.[0].video_info?.variants).toHaveLength(1);
  });

  it("maps a photo without video_info", () => {
    const tweet = tweetFromXquik({
      ...base,
      media: [{ type: "photo", mediaUrl: "https://pbs.twimg.com/photo.jpg" }],
    });

    const media = tweet.extendedEntities?.media?.[0];
    expect(media?.type).toBe("photo");
    expect(media?.video_info).toBeUndefined();
  });

  it("leaves extendedEntities undefined when there is no media", () => {
    expect(tweetFromXquik(base).extendedEntities).toBeUndefined();
  });

  it("maps a quoted tweet and sets isQuote", () => {
    const tweet = tweetFromXquik({
      ...base,
      isQuoteStatus: true,
      quoted_tweet: { id: "999", text: "quoted", author: { username: "someone" } },
    });

    expect(tweet.isQuote).toBe(true);
    expect(tweet.quoted_tweet?.id).toBe("999");
    expect(tweet.quoted_tweet?.author.userName).toBe("someone");
  });
});
