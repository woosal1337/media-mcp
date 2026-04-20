import { execFile } from "node:child_process";
import { createWriteStream, unlinkSync, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { transcribe, renderTranscript, type TranscriptResult } from "./transcribe.js";
import { cacheVideo, getCachedVideoPath } from "./video-cache.js";

const TWITTER_API_BASE = "https://api.twitterapi.io";
const TWEETS_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweets`;
const THREAD_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/thread_context`;
const ARTICLE_ENDPOINT = `${TWITTER_API_BASE}/twitter/article`;
const USER_INFO_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/info`;
const USER_TWEETS_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/last_tweets`;
const USER_FOLLOWERS_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/followers`;
const USER_FOLLOWING_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/followings`;
const TWEET_REPLIES_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/replies`;
const TWEET_QUOTES_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/quotes`;
const TWEET_RETWEETERS_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/retweeters`;
const SEARCH_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/advanced_search`;
const TRENDS_ENDPOINT = `${TWITTER_API_BASE}/twitter/trends`;
const USER_ABOUT_ENDPOINT = `${TWITTER_API_BASE}/twitter/user_about`;
const USER_MENTIONS_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/mentions`;
const USER_SEARCH_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/search`;
const VERIFIED_FOLLOWERS_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/verifiedFollowers`;
const CHECK_FOLLOW_ENDPOINT = `${TWITTER_API_BASE}/twitter/user/check_follow_relationship`;
const TWEET_REPLIES_V2_ENDPOINT = `${TWITTER_API_BASE}/twitter/tweet/replies/v2`;
const LIST_TIMELINE_ENDPOINT = `${TWITTER_API_BASE}/twitter/list/tweets_timeline`;
const LIST_MEMBERS_ENDPOINT = `${TWITTER_API_BASE}/twitter/list/members`;
const COMMUNITY_TWEETS_ENDPOINT = `${TWITTER_API_BASE}/twitter/community/tweets`;
const COMMUNITY_INFO_ENDPOINT = `${TWITTER_API_BASE}/twitter/community/info`;
const SPACE_DETAIL_ENDPOINT = `${TWITTER_API_BASE}/twitter/spaces/detail`;
const MONITOR_ADD_ENDPOINT = `${TWITTER_API_BASE}/oapi/x_user_stream/add_user_to_monitor_tweet`;
const MONITOR_LIST_ENDPOINT = `${TWITTER_API_BASE}/oapi/x_user_stream/get_user_to_monitor_tweet`;
const MONITOR_REMOVE_ENDPOINT = `${TWITTER_API_BASE}/oapi/x_user_stream/remove_user_to_monitor_tweet`;
const FILTER_ADD_ENDPOINT = `${TWITTER_API_BASE}/oapi/tweet_filter/add_rule`;
const FILTER_LIST_ENDPOINT = `${TWITTER_API_BASE}/oapi/tweet_filter/get_rules`;
const FILTER_UPDATE_ENDPOINT = `${TWITTER_API_BASE}/oapi/tweet_filter/update_rule`;
const FILTER_DELETE_ENDPOINT = `${TWITTER_API_BASE}/oapi/tweet_filter/delete_rule`;
const BOOKMARKS_ENDPOINT = `${TWITTER_API_BASE}/twitter/bookmarks_v2`;

interface TweetMediaVariant {
  bitrate?: number;
  content_type: string;
  url: string;
}

interface TweetMedia {
  type: "video" | "photo";
  media_url_https: string;
  video_info?: {
    duration_millis: number;
    variants: TweetMediaVariant[];
  };
}

interface TweetEntities {
  urls?: Array<{ expanded_url?: string }>;
}

interface TweetAuthor {
  userName: string;
  name: string;
  profilePicture: string;
  followers: number;
}

interface Tweet {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  viewCount: number;
  bookmarkCount: number;
  lang: string;
  author: TweetAuthor;
  extendedEntities?: { media?: TweetMedia[] };
  entities?: TweetEntities;
  quoted_tweet?: Tweet | null;
  isQuote: boolean;
}

export interface ProcessedTweet {
  id: string;
  url: string;
  text: string;
  author: {
    username: string;
    name: string;
    followers: number;
  };
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    views: number;
    bookmarks: number;
  };
  createdAt: string;
  language: string;
  media: ProcessedMedia[];
  quotedTweet?: ProcessedTweet;
  videoTranscription?: string;
  threadTweets?: ProcessedTweet[];
  articleContent?: string;
  articleTitle?: string;
}

export interface ProcessedMedia {
  type: "video" | "photo";
  url: string;
  thumbnailUrl?: string;
  durationMs?: number;
  videoUrl?: string;
}

function extractTweetId(input: string): string {
  const match = input.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  if (match) return match[1];
  if (/^\d+$/.test(input)) return input;
  throw new Error(`Cannot extract tweet ID from: ${input}`);
}

function getBestVideoUrl(videoInfo: TweetMedia["video_info"]): string | null {
  if (!videoInfo?.variants) return null;
  const mp4s = videoInfo.variants
    .filter((v): v is TweetMediaVariant & { bitrate: number } =>
      v.content_type === "video/mp4" && v.bitrate !== undefined
    )
    .sort((a, b) => b.bitrate - a.bitrate);
  return mp4s[0]?.url ?? null;
}

function processMedia(media: TweetMedia[]): ProcessedMedia[] {
  return media.map((m) => {
    const processed: ProcessedMedia = {
      type: m.type,
      url: m.media_url_https,
    };
    if (m.type === "video" && m.video_info) {
      processed.thumbnailUrl = m.media_url_https;
      processed.durationMs = m.video_info.duration_millis;
      processed.videoUrl = getBestVideoUrl(m.video_info) ?? undefined;
    }
    return processed;
  });
}

function processTweet(tweet: Tweet): ProcessedTweet {
  const media = tweet.extendedEntities?.media
    ? processMedia(tweet.extendedEntities.media)
    : [];

  const processed: ProcessedTweet = {
    id: tweet.id,
    url: tweet.url,
    text: tweet.text,
    author: {
      username: tweet.author.userName,
      name: tweet.author.name,
      followers: tweet.author.followers,
    },
    metrics: {
      likes: tweet.likeCount,
      retweets: tweet.retweetCount,
      replies: tweet.replyCount,
      views: tweet.viewCount,
      bookmarks: tweet.bookmarkCount,
    },
    createdAt: tweet.createdAt,
    language: tweet.lang,
    media,
  };

  if (tweet.isQuote && tweet.quoted_tweet) {
    processed.quotedTweet = processTweet(tweet.quoted_tweet);
  }

  return processed;
}


async function downloadVideo(videoUrl: string): Promise<string> {
  const filePath = join(tmpdir(), `media-mcp-${randomUUID()}.mp4`);
  const response = await fetch(videoUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body as any);
  const fileStream = createWriteStream(filePath);
  await pipeline(nodeStream, fileStream);
  return filePath;
}

function extractAudio(videoPath: string): Promise<string> {
  const audioPath = videoPath.replace(".mp4", ".wav");
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

export async function transcribeVideo(
  videoUrl: string,
  modelPath: string
): Promise<string> {
  const result = await transcribeVideoStructured(videoUrl, modelPath);
  return renderTranscript(result);
}

export async function transcribeVideoStructured(
  videoUrl: string,
  modelPath: string
): Promise<TranscriptResult> {
  let videoPath = getCachedVideoPath(videoUrl);
  let downloadedFresh = false;
  let audioPath = "";
  try {
    if (!videoPath) {
      videoPath = await downloadVideo(videoUrl);
      downloadedFresh = true;
      cacheVideo(videoUrl, videoPath);
    }
    audioPath = await extractAudio(videoPath);
    return await transcribe(audioPath, modelPath);
  } finally {
    if (downloadedFresh && videoPath) cleanup(videoPath);
    if (audioPath) cleanup(audioPath);
  }
}


async function fetchThread(tweetId: string, apiKey: string): Promise<Tweet[]> {
  try {
    const response = await fetch(
      `${THREAD_ENDPOINT}?tweetId=${tweetId}`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!response.ok) return [];
    const data = await response.json() as { tweets?: Tweet[] };
    return data.tweets ?? [];
  } catch {
    return [];
  }
}

async function fetchArticle(
  tweetId: string,
  apiKey: string
): Promise<{ title: string; content: string } | null> {
  try {
    const response = await fetch(
      `${ARTICLE_ENDPOINT}?tweet_id=${tweetId}`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!response.ok) return null;
    const data = await response.json() as {
      article?: {
        title?: string;
        preview_text?: string;
        contents?: Array<{ type: string; text: string }>;
      };
    };
    const article = data.article;
    if (!article) return null;
    const content = article.contents
      ?.map((block) => block.text)
      .filter(Boolean)
      .join("\n\n") ?? article.preview_text ?? "";
    return { title: article.title ?? "", content };
  } catch {
    return null;
  }
}

function hasArticleLink(entities: TweetEntities | undefined): boolean {
  return entities?.urls?.some((u) =>
    u.expanded_url?.includes("x.com/i/article") ||
    u.expanded_url?.includes("twitter.com/i/article")
  ) ?? false;
}


export interface UserProfile {
  id: string;
  username: string;
  name: string;
  description: string;
  followers: number;
  following: number;
  tweets: number;
  listed: number;
  createdAt: string;
  verified: boolean;
  profilePicture: string;
  bannerUrl: string;
  location: string;
  website: string;
}

export async function fetchUserProfile(
  username: string,
  apiKey: string
): Promise<UserProfile> {
  const response = await fetch(`${USER_INFO_ENDPOINT}?userName=${encodeURIComponent(username)}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { data?: any };
  const u = data.data;
  if (!u) throw new Error(`User not found: ${username}`);

  return {
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? username,
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? u.statusesCount ?? 0,
    listed: u.listed_count ?? u.listedCount ?? 0,
    createdAt: u.createdAt ?? u.created_at ?? "",
    verified: u.isBlueVerified ?? u.verified ?? false,
    profilePicture: u.profilePicture ?? u.profile_image_url_https ?? "",
    bannerUrl: u.profile_banner_url ?? u.profileBannerUrl ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  };
}


export async function fetchUserTweets(
  username: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${USER_TWEETS_ENDPOINT}?userName=${encodeURIComponent(username)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  const tweets = (data.tweets ?? []).map(processTweet);
  const nextCursor = data.has_next_page ? (data.next_cursor ?? null) : null;

  return { tweets, nextCursor };
}


export async function fetchUserFollowers(
  username: string,
  apiKey: string,
  cursor?: string
): Promise<{ users: UserProfile[]; nextCursor: string | null }> {
  let url = `${USER_FOLLOWERS_ENDPOINT}?userName=${encodeURIComponent(username)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { followers?: any[]; has_next_page?: boolean; next_cursor?: string };
  const users: UserProfile[] = (data.followers ?? []).map((u: any) => ({
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? "",
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? 0,
    listed: u.listed_count ?? 0,
    createdAt: u.createdAt ?? "",
    verified: u.isBlueVerified ?? false,
    profilePicture: u.profilePicture ?? "",
    bannerUrl: u.profile_banner_url ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  }));

  return { users, nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null };
}

export async function fetchUserFollowing(
  username: string,
  apiKey: string,
  cursor?: string
): Promise<{ users: UserProfile[]; nextCursor: string | null }> {
  let url = `${USER_FOLLOWING_ENDPOINT}?userName=${encodeURIComponent(username)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { followings?: any[]; has_next_page?: boolean; next_cursor?: string };
  const users: UserProfile[] = (data.followings ?? []).map((u: any) => ({
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? "",
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? 0,
    listed: u.listed_count ?? 0,
    createdAt: u.createdAt ?? "",
    verified: u.isBlueVerified ?? false,
    profilePicture: u.profilePicture ?? "",
    bannerUrl: u.profile_banner_url ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  }));

  return { users, nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null };
}


export async function fetchTweetReplies(
  tweetId: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${TWEET_REPLIES_ENDPOINT}?tweetId=${tweetId}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);

  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}

export async function fetchTweetQuotes(
  tweetId: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${TWEET_QUOTES_ENDPOINT}?tweetId=${tweetId}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);

  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}

export async function fetchTweetRetweeters(
  tweetId: string,
  apiKey: string,
  cursor?: string
): Promise<{ users: UserProfile[]; nextCursor: string | null }> {
  let url = `${TWEET_RETWEETERS_ENDPOINT}?tweetId=${tweetId}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);

  const data = await response.json() as { users?: any[]; has_next_page?: boolean; next_cursor?: string };
  const users: UserProfile[] = (data.users ?? []).map((u: any) => ({
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? "",
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? 0,
    listed: u.listed_count ?? 0,
    createdAt: u.createdAt ?? "",
    verified: u.isBlueVerified ?? false,
    profilePicture: u.profilePicture ?? "",
    bannerUrl: u.profile_banner_url ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  }));

  return { users, nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null };
}


export async function searchTweets(
  query: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);

  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function fetchTrends(
  apiKey: string,
  woeid: number = 1
): Promise<Array<{ name: string; tweetVolume: number | null }>> {
  const response = await fetch(`${TRENDS_ENDPOINT}?woeid=${woeid}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);

  const data = await response.json() as { trends?: Array<{ name: string; tweet_volume?: number }> };
  return (data.trends ?? []).map((t) => ({
    name: t.name,
    tweetVolume: t.tweet_volume ?? null,
  }));
}


export async function fetchUserAbout(
  username: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(`${USER_ABOUT_ENDPOINT}?userName=${encodeURIComponent(username)}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}


export async function fetchUserMentions(
  username: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${USER_MENTIONS_ENDPOINT}?userName=${encodeURIComponent(username)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function searchUsers(
  query: string,
  apiKey: string
): Promise<UserProfile[]> {
  const response = await fetch(`${USER_SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { users?: any[] };
  return (data.users ?? []).map((u: any) => ({
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? "",
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? 0,
    listed: u.listed_count ?? 0,
    createdAt: u.createdAt ?? "",
    verified: u.isBlueVerified ?? false,
    profilePicture: u.profilePicture ?? "",
    bannerUrl: u.profile_banner_url ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  }));
}


export async function fetchVerifiedFollowers(
  username: string,
  apiKey: string,
  cursor?: string
): Promise<{ users: UserProfile[]; nextCursor: string | null }> {
  let url = `${VERIFIED_FOLLOWERS_ENDPOINT}?userName=${encodeURIComponent(username)}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { followers?: any[]; has_next_page?: boolean; next_cursor?: string };
  const users: UserProfile[] = (data.followers ?? []).map((u: any) => ({
    id: u.id ?? u.rest_id ?? "",
    username: u.userName ?? u.screen_name ?? "",
    name: u.name ?? "",
    description: u.description ?? "",
    followers: u.followers ?? u.followers_count ?? 0,
    following: u.following ?? u.friends_count ?? 0,
    tweets: u.statuses_count ?? 0,
    listed: u.listed_count ?? 0,
    createdAt: u.createdAt ?? "",
    verified: true,
    profilePicture: u.profilePicture ?? "",
    bannerUrl: u.profile_banner_url ?? "",
    location: u.location ?? "",
    website: u.website ?? u.url ?? "",
  }));
  return { users, nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null };
}


export async function checkFollowRelationship(
  sourceUsername: string,
  targetUsername: string,
  apiKey: string
): Promise<{ sourceFollowsTarget: boolean; targetFollowsSource: boolean }> {
  const response = await fetch(
    `${CHECK_FOLLOW_ENDPOINT}?source_user_name=${encodeURIComponent(sourceUsername)}&target_user_name=${encodeURIComponent(targetUsername)}`,
    { headers: { "x-api-key": apiKey } }
  );
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as any;
  return {
    sourceFollowsTarget: data.source_follows_target ?? data.following ?? false,
    targetFollowsSource: data.target_follows_source ?? data.followed_by ?? false,
  };
}


export async function fetchTweetRepliesV2(
  tweetId: string,
  apiKey: string,
  sortBy: "Relevance" | "Latest" | "Likes" = "Relevance",
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${TWEET_REPLIES_V2_ENDPOINT}?tweetId=${tweetId}&sortBy=${sortBy}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function fetchListTimeline(
  listId: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${LIST_TIMELINE_ENDPOINT}?listId=${listId}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function fetchCommunityTweets(
  communityId: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  let url = `${COMMUNITY_TWEETS_ENDPOINT}?communityId=${communityId}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function fetchSpaceDetail(
  spaceId: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(`${SPACE_DETAIL_ENDPOINT}?spaceId=${spaceId}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}


export async function fetchBookmarks(
  loginCookie: string,
  apiKey: string,
  cursor?: string
): Promise<{ tweets: ProcessedTweet[]; nextCursor: string | null }> {
  const body: any = { login_cookie: loginCookie };
  if (cursor) body.cursor = cursor;
  const response = await fetch(BOOKMARKS_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  const data = await response.json() as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
  return {
    tweets: (data.tweets ?? []).map(processTweet),
    nextCursor: data.has_next_page ? (data.next_cursor ?? null) : null,
  };
}


export async function addUserToMonitor(
  username: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(MONITOR_ADD_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ user_name: username }),
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}

export async function getMonitoredUsers(apiKey: string): Promise<any> {
  const response = await fetch(MONITOR_LIST_ENDPOINT, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}

export async function removeUserFromMonitor(
  username: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(MONITOR_REMOVE_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ user_name: username }),
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}


export async function addFilterRule(
  tag: string,
  value: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(FILTER_ADD_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ tag, value }),
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}

export async function getFilterRules(apiKey: string): Promise<any> {
  const response = await fetch(FILTER_LIST_ENDPOINT, { headers: { "x-api-key": apiKey } });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}

export async function deleteFilterRule(
  ruleId: string,
  apiKey: string
): Promise<any> {
  const response = await fetch(FILTER_DELETE_ENDPOINT, {
    method: "DELETE",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ rule_id: ruleId }),
  });
  if (!response.ok) throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  return await response.json();
}


export async function fetchTweet(
  tweetUrl: string,
  apiKey: string
): Promise<ProcessedTweet> {
  const tweetId = extractTweetId(tweetUrl);
  const response = await fetch(`${TWEETS_ENDPOINT}?tweet_ids=${tweetId}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { tweets: Tweet[] };
  if (!data.tweets?.length) {
    throw new Error(`No tweet found for ID: ${tweetId}`);
  }

  const rawTweet = data.tweets[0];
  const processed = processTweet(rawTweet);

  if (rawTweet.isQuote && rawTweet.quoted_tweet?.id) {
    try {
      const qtResponse = await fetch(
        `${TWEETS_ENDPOINT}?tweet_ids=${rawTweet.quoted_tweet.id}`,
        { headers: { "x-api-key": apiKey } }
      );
      if (qtResponse.ok) {
        const qtData = await qtResponse.json() as { tweets: Tweet[] };
        if (qtData.tweets?.length) {
          const fullQuotedTweet = qtData.tweets[0];
          processed.quotedTweet = processTweet(fullQuotedTweet);

          if (hasArticleLink(fullQuotedTweet.entities)) {
            const qtArticle = await fetchArticle(fullQuotedTweet.id, apiKey);
            if (qtArticle) {
              processed.quotedTweet.articleTitle = qtArticle.title;
              processed.quotedTweet.articleContent = qtArticle.content;
            }
          }
        }
      }
    } catch {
    }
  }

  const threadTweets = await fetchThread(tweetId, apiKey);
  if (threadTweets.length > 1) {
    const authorThreadTweets = threadTweets.filter(
      (t) => t.author.userName === rawTweet.author.userName && t.id !== tweetId
    );
    if (authorThreadTweets.length > 0) {
      processed.threadTweets = authorThreadTweets.map(processTweet);
    }
  }

  if (hasArticleLink(rawTweet.entities)) {
    const article = await fetchArticle(tweetId, apiKey);
    if (article) {
      processed.articleTitle = article.title;
      processed.articleContent = article.content;
    }
  }

  return processed;
}
