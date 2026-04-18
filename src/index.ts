#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchTweet, transcribeVideo,
  fetchUserProfile, fetchUserAbout, fetchUserTweets, fetchUserFollowers, fetchUserFollowing,
  fetchUserMentions, searchUsers, fetchVerifiedFollowers, checkFollowRelationship,
  fetchTweetReplies, fetchTweetRepliesV2, fetchTweetQuotes, fetchTweetRetweeters,
  searchTweets, fetchTrends, fetchListTimeline, fetchCommunityTweets,
  fetchSpaceDetail, fetchBookmarks,
  addUserToMonitor, getMonitoredUsers, removeUserFromMonitor,
  addFilterRule, getFilterRules, deleteFilterRule,
  type ProcessedTweet, type ProcessedMedia, type UserProfile,
} from "./twitter.js";
import { fetchYouTubeTranscript } from "./youtube.js";
import { fetchInstagramPost, isInstagramUrl, type MediaItem } from "./instagram.js";
import { extractFrames } from "./frames.js";
import { fetchMarkdown } from "./cloudflare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = process.env.WHISPER_MODEL_PATH
  ?? join(__dirname, "..", "models", "ggml-base.bin");

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;

if (!TWITTER_API_KEY) {
  console.error("TWITTER_API_KEY environment variable is required");
  process.exit(1);
}

const apiKey: string = TWITTER_API_KEY;

function formatMedia(media: ProcessedMedia[]): string {
  let out = "";
  for (const m of media) {
    if (m.type === "photo") {
      out += `- Image: ${m.url}\n`;
    } else if (m.type === "video") {
      out += `- Video (${Math.round((m.durationMs ?? 0) / 1000)}s): ${m.videoUrl}\n`;
      if (m.thumbnailUrl) out += `  Thumbnail: ${m.thumbnailUrl}\n`;
    }
  }
  return out;
}

function formatTweetOutput(tweet: ProcessedTweet): string {
  let output = `**@${tweet.author.username}** (${tweet.author.name})\n`;
  output += `${tweet.text}\n\n`;
  output += `Likes: ${tweet.metrics.likes} | Retweets: ${tweet.metrics.retweets} | Views: ${tweet.metrics.views} | Bookmarks: ${tweet.metrics.bookmarks}\n`;
  output += `Posted: ${tweet.createdAt}\n`;

  if (tweet.media.length > 0) {
    output += `\n**Media:**\n${formatMedia(tweet.media)}`;
  }

  if (tweet.videoTranscription) {
    output += `\n**Video Transcription:**\n${tweet.videoTranscription}\n`;
  }

  if (tweet.quotedTweet) {
    output += `\n**Quoted Tweet by @${tweet.quotedTweet.author.username}:**\n`;
    output += `${tweet.quotedTweet.text}\n`;
    if (tweet.quotedTweet.media.length > 0) {
      output += formatMedia(tweet.quotedTweet.media);
    }
    if (tweet.quotedTweet.videoTranscription) {
      output += `\n**Quoted Video Transcription:**\n${tweet.quotedTweet.videoTranscription}\n`;
    }
  }

  if (tweet.articleTitle || tweet.articleContent) {
    output += `\n**Article: ${tweet.articleTitle}**\n`;
    output += `${tweet.articleContent}\n`;
  }

  if (tweet.threadTweets && tweet.threadTweets.length > 0) {
    output += `\n**Thread (${tweet.threadTweets.length} more tweets):**\n`;
    for (const t of tweet.threadTweets) {
      output += `\n---\n${t.text}\n`;
    }
  }

  return output;
}

async function transcribeTweetMedia(tweet: ProcessedTweet): Promise<void> {
  const video = tweet.media.find((m) => m.type === "video" && m.videoUrl);
  if (video?.videoUrl) {
    try {
      tweet.videoTranscription = await transcribeVideo(video.videoUrl, MODEL_PATH);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      tweet.videoTranscription = `[Transcription failed: ${message}]`;
    }
  }
}


const server = new McpServer({
  name: "media-mcp",
  version: "1.0.0",
});

server.tool(
  "get_tweet",
  "Fetch a tweet by URL. Returns tweet text, author info, metrics, and media. If the tweet contains a video, automatically transcribes the audio and includes the transcription. Also fetches quoted tweets, threads, and Twitter articles.",
  {
    url: z.string().describe("Twitter/X URL (e.g. https://x.com/user/status/123)"),
    transcribe: z.boolean().default(true).describe("Whether to transcribe video content (default: true)"),
  },
  async ({ url, transcribe }) => {
    try {
      const tweet = await fetchTweet(url, apiKey);

      if (transcribe) {
        await transcribeTweetMedia(tweet);
        if (tweet.quotedTweet) {
          await transcribeTweetMedia(tweet.quotedTweet);
        }
      }

      return {
        content: [{ type: "text", text: formatTweetOutput(tweet) }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);


server.tool(
  "get_user_profile",
  "Fetch a Twitter/X user's profile by username. Returns bio, follower/following counts, tweet count, verification status, location, and website.",
  {
    username: z.string().describe("Twitter username without @ (e.g. 'elonmusk')"),
  },
  async ({ username }) => {
    try {
      const user = await fetchUserProfile(username, apiKey);
      let output = `**@${user.username}** (${user.name})\n`;
      if (user.verified) output += `Verified\n`;
      output += `\n${user.description}\n\n`;
      output += `Followers: ${user.followers.toLocaleString()} | Following: ${user.following.toLocaleString()} | Tweets: ${user.tweets.toLocaleString()}\n`;
      if (user.location) output += `Location: ${user.location}\n`;
      if (user.website) output += `Website: ${user.website}\n`;
      output += `Joined: ${user.createdAt}\n`;
      if (user.profilePicture) output += `Avatar: ${user.profilePicture}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_user_tweets",
  "Fetch recent tweets from a Twitter/X user. Returns up to 20 tweets per page with text, metrics, and media. Use cursor for pagination.",
  {
    username: z.string().describe("Twitter username without @ (e.g. 'elonmusk')"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  },
  async ({ username, cursor }) => {
    try {
      const result = await fetchUserTweets(username, apiKey, cursor);
      let output = `**@${username}'s recent tweets** (${result.tweets.length} tweets)\n\n`;
      for (const t of result.tweets) {
        output += `---\n${t.text}\n`;
        output += `Likes: ${t.metrics.likes} | RT: ${t.metrics.retweets} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_user_followers",
  "Fetch followers of a Twitter/X user. Returns up to 200 per page with profile info.",
  {
    username: z.string().describe("Twitter username without @"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ username, cursor }) => {
    try {
      const result = await fetchUserFollowers(username, apiKey, cursor);
      let output = `**@${username}'s followers** (${result.users.length} returned)\n\n`;
      for (const u of result.users) {
        output += `- **@${u.username}** (${u.name}) — ${u.followers.toLocaleString()} followers${u.verified ? " ✓" : ""}\n`;
        if (u.description) output += `  ${u.description.slice(0, 100)}${u.description.length > 100 ? "..." : ""}\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_user_following",
  "Fetch accounts a Twitter/X user follows. Returns up to 200 per page with profile info.",
  {
    username: z.string().describe("Twitter username without @"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ username, cursor }) => {
    try {
      const result = await fetchUserFollowing(username, apiKey, cursor);
      let output = `**@${username}'s following** (${result.users.length} returned)\n\n`;
      for (const u of result.users) {
        output += `- **@${u.username}** (${u.name}) — ${u.followers.toLocaleString()} followers${u.verified ? " ✓" : ""}\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_tweet_replies",
  "Fetch replies to a specific tweet. Returns up to 20 replies per page.",
  {
    tweet_url: z.string().describe("Twitter/X URL of the tweet"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ tweet_url, cursor }) => {
    try {
      const tweetId = tweet_url.match(/status\/(\d+)/)?.[1] ?? tweet_url;
      const result = await fetchTweetReplies(tweetId, apiKey, cursor);
      let output = `**Replies** (${result.tweets.length} returned)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_tweet_quotes",
  "Fetch quote tweets of a specific tweet. Returns up to 20 per page.",
  {
    tweet_url: z.string().describe("Twitter/X URL of the tweet"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ tweet_url, cursor }) => {
    try {
      const tweetId = tweet_url.match(/status\/(\d+)/)?.[1] ?? tweet_url;
      const result = await fetchTweetQuotes(tweetId, apiKey, cursor);
      let output = `**Quote Tweets** (${result.tweets.length} returned)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_tweet_retweeters",
  "Fetch users who retweeted a specific tweet. Returns up to 100 per page.",
  {
    tweet_url: z.string().describe("Twitter/X URL of the tweet"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ tweet_url, cursor }) => {
    try {
      const tweetId = tweet_url.match(/status\/(\d+)/)?.[1] ?? tweet_url;
      const result = await fetchTweetRetweeters(tweetId, apiKey, cursor);
      let output = `**Retweeters** (${result.users.length} returned)\n\n`;
      for (const u of result.users) {
        output += `- **@${u.username}** (${u.name}) — ${u.followers.toLocaleString()} followers\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "search_tweets",
  "Search Twitter/X with advanced query syntax. Returns up to 20 tweets per page. Supports operators like 'from:user', 'to:user', '#hashtag', 'min_faves:100', date ranges, etc.",
  {
    query: z.string().describe("Search query (supports Twitter advanced search operators)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ query, cursor }) => {
    try {
      const result = await searchTweets(query, apiKey, cursor);
      let output = `**Search: "${query}"** (${result.tweets.length} results)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\n`;
        output += `Likes: ${t.metrics.likes} | RT: ${t.metrics.retweets} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_trends",
  "Fetch current trending topics on Twitter/X. Optionally specify a WOEID for location-specific trends (1 = worldwide, 23424977 = US, 23424969 = Turkey).",
  {
    woeid: z.number().default(1).describe("Where On Earth ID (1 = worldwide)"),
  },
  async ({ woeid }) => {
    try {
      const trends = await fetchTrends(apiKey, woeid);
      let output = `**Trending Topics** (WOEID: ${woeid})\n\n`;
      for (const t of trends) {
        output += `- **${t.name}**${t.tweetVolume ? ` — ${t.tweetVolume.toLocaleString()} tweets` : ""}\n`;
      }
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_user_about",
  "Fetch extended profile/about info for a Twitter/X user. Returns additional bio details beyond the basic profile.",
  { username: z.string().describe("Twitter username without @") },
  async ({ username }) => {
    try {
      const data = await fetchUserAbout(username, apiKey);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_user_mentions",
  "Fetch tweets that mention a specific Twitter/X user. Returns up to 20 mentions per page. Use to see who's talking about you or any user.",
  {
    username: z.string().describe("Twitter username without @"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ username, cursor }) => {
    try {
      const result = await fetchUserMentions(username, apiKey, cursor);
      let output = `**Mentions of @${username}** (${result.tweets.length} returned)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | RT: ${t.metrics.retweets} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "search_users",
  "Search for Twitter/X users by keyword. Find influencers, competitors, or accounts in any niche.",
  { query: z.string().describe("Search keyword (e.g. 'fintech founder', 'react native developer')") },
  async ({ query }) => {
    try {
      const users = await searchUsers(query, apiKey);
      let output = `**User search: "${query}"** (${users.length} results)\n\n`;
      for (const u of users) {
        output += `- **@${u.username}** (${u.name}) — ${u.followers.toLocaleString()} followers${u.verified ? " ✓" : ""}\n`;
        if (u.description) output += `  ${u.description.slice(0, 120)}${u.description.length > 120 ? "..." : ""}\n`;
      }
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_verified_followers",
  "Fetch verified (blue check) followers of a Twitter/X user. 20 per page. Use to identify high-value followers on any account.",
  {
    username: z.string().describe("Twitter username without @"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ username, cursor }) => {
    try {
      const result = await fetchVerifiedFollowers(username, apiKey, cursor);
      let output = `**@${username}'s verified followers** (${result.users.length} returned)\n\n`;
      for (const u of result.users) {
        output += `- **@${u.username}** (${u.name}) — ${u.followers.toLocaleString()} followers\n`;
        if (u.description) output += `  ${u.description.slice(0, 100)}${u.description.length > 100 ? "..." : ""}\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "check_follow_relationship",
  "Check if user A follows user B and vice versa. Use to verify mutual follows or check if a target already follows you.",
  {
    source_username: z.string().describe("First username (without @)"),
    target_username: z.string().describe("Second username (without @)"),
  },
  async ({ source_username, target_username }) => {
    try {
      const result = await checkFollowRelationship(source_username, target_username, apiKey);
      let output = `**Follow relationship: @${source_username} ↔ @${target_username}**\n\n`;
      output += `@${source_username} follows @${target_username}: ${result.sourceFollowsTarget ? "Yes" : "No"}\n`;
      output += `@${target_username} follows @${source_username}: ${result.targetFollowsSource ? "Yes" : "No"}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_tweet_replies_v2",
  "Fetch replies to a tweet with sorting. Sort by Relevance, Latest, or Likes to find the most engaging responses.",
  {
    tweet_url: z.string().describe("Twitter/X URL of the tweet"),
    sort_by: z.enum(["Relevance", "Latest", "Likes"]).default("Relevance").describe("Sort order"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ tweet_url, sort_by, cursor }) => {
    try {
      const tweetId = tweet_url.match(/status\/(\d+)/)?.[1] ?? tweet_url;
      const result = await fetchTweetRepliesV2(tweetId, apiKey, sort_by, cursor);
      let output = `**Replies (sorted by ${sort_by})** (${result.tweets.length} returned)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_list_timeline",
  "Fetch tweets from a Twitter/X list. Use list IDs from curated lists to get niche-specific content feeds.",
  {
    list_id: z.string().describe("Twitter list ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ list_id, cursor }) => {
    try {
      const result = await fetchListTimeline(list_id, apiKey, cursor);
      let output = `**List timeline** (${result.tweets.length} tweets)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | RT: ${t.metrics.retweets} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_community_tweets",
  "Fetch tweets from a Twitter/X community. Browse community content for engagement opportunities.",
  {
    community_id: z.string().describe("Twitter community ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ community_id, cursor }) => {
    try {
      const result = await fetchCommunityTweets(community_id, apiKey, cursor);
      let output = `**Community tweets** (${result.tweets.length} returned)\n\n`;
      for (const t of result.tweets) {
        output += `---\n**@${t.author.username}**: ${t.text}\nLikes: ${t.metrics.likes} | RT: ${t.metrics.retweets} | Views: ${t.metrics.views} | ${t.createdAt}\n\n`;
      }
      if (result.nextCursor) output += `\n**Next page cursor:** ${result.nextCursor}\n`;
      return { content: [{ type: "text", text: output }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_space_detail",
  "Fetch details about a Twitter/X Space — title, host, speakers, listener count, state.",
  { space_id: z.string().describe("Twitter Space ID") },
  async ({ space_id }) => {
    try {
      const data = await fetchSpaceDetail(space_id, apiKey);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "monitor_user_add",
  "Start monitoring a Twitter/X user for real-time tweet notifications. Use to track when competitors or influencers post.",
  { username: z.string().describe("Twitter username to monitor (without @)") },
  async ({ username }) => {
    try {
      const data = await addUserToMonitor(username, apiKey);
      return { content: [{ type: "text", text: `Monitoring @${username} for real-time tweets.\n${JSON.stringify(data, null, 2)}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "monitor_user_list",
  "List all Twitter/X users currently being monitored for real-time tweets.",
  {},
  async () => {
    try {
      const data = await getMonitoredUsers(apiKey);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "monitor_user_remove",
  "Stop monitoring a Twitter/X user for real-time tweets.",
  { username: z.string().describe("Twitter username to stop monitoring (without @)") },
  async ({ username }) => {
    try {
      const data = await removeUserFromMonitor(username, apiKey);
      return { content: [{ type: "text", text: `Stopped monitoring @${username}.\n${JSON.stringify(data, null, 2)}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "filter_rule_add",
  "Add a tweet filter rule for real-time keyword monitoring. Matches tweets containing specific terms.",
  {
    tag: z.string().describe("Rule name/tag for identification"),
    value: z.string().describe("Filter expression (keywords, operators)"),
  },
  async ({ tag, value }) => {
    try {
      const data = await addFilterRule(tag, value, apiKey);
      return { content: [{ type: "text", text: `Filter rule '${tag}' added.\n${JSON.stringify(data, null, 2)}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "filter_rule_list",
  "List all active tweet filter rules for real-time monitoring.",
  {},
  async () => {
    try {
      const data = await getFilterRules(apiKey);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);

server.tool(
  "filter_rule_delete",
  "Delete a tweet filter rule to stop real-time keyword monitoring.",
  { rule_id: z.string().describe("Rule ID to delete") },
  async ({ rule_id }) => {
    try {
      const data = await deleteFilterRule(rule_id, apiKey);
      return { content: [{ type: "text", text: `Filter rule deleted.\n${JSON.stringify(data, null, 2)}` }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  }
);


server.tool(
  "get_youtube_transcript",
  "Fetch the transcript/subtitles of a YouTube video. First tries YouTube captions (instant). If no captions exist, downloads the audio and transcribes locally with Whisper.",
  {
    url: z.string().describe("YouTube URL (e.g. https://www.youtube.com/watch?v=abc123)"),
  },
  async ({ url }) => {
    try {
      const transcript = await fetchYouTubeTranscript(url, MODEL_PATH);

      let output = `**YouTube Transcript** (${transcript.videoId})\n`;
      output += `Source: ${transcript.source === "captions" ? "YouTube captions" : "Whisper transcription (no captions available)"}\n\n`;
      output += `**Full Text:**\n${transcript.text}\n`;

      if (transcript.segments.length > 0) {
        output += `\n**Segments (${transcript.segments.length}):**\n`;
        for (const seg of transcript.segments) {
          const mins = Math.floor(seg.offset / 60000);
          const secs = Math.floor((seg.offset % 60000) / 1000);
          const ts = `${mins}:${secs.toString().padStart(2, "0")}`;
          output += `[${ts}] ${seg.text}\n`;
        }
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error fetching transcript: ${message}` }],
        isError: true,
      };
    }
  }
);


server.tool(
  "get_instagram_post",
  "Fetch an Instagram post or reel by URL. Downloads ALL media (carousel images, videos) to a local folder with a unique ID. Videos are transcribed with Whisper. Returns local file paths so Claude can read/analyze the images directly. Supports single posts, reels, and carousel posts with multiple images/videos.",
  {
    url: z.string().describe("Instagram URL (e.g. https://www.instagram.com/reel/XXXXX/ or https://www.instagram.com/p/XXXXX/)"),
    transcribe: z.boolean().default(true).describe("Whether to transcribe video content (default: true)"),
  },
  async ({ url, transcribe }) => {
    try {
      const post = await fetchInstagramPost(url, MODEL_PATH, transcribe);

      let output = `**Instagram Post**\n`;
      output += `**Source:** ${post.url}\n`;
      output += `**Type:** ${post.isCarousel ? `Carousel (${post.media.length} items)` : "Single post"}\n`;
      if (post.mediaFolder) output += `**Media Folder:** ${post.mediaFolder}\n`;
      if (post.filename) output += `**Filename:** ${post.filename}\n`;
      if (post.audioUrl) output += `**Audio URL:** ${post.audioUrl}\n`;

      if (post.media.length > 0) {
        output += `\n**Media (${post.media.length} items):**\n`;
        for (let i = 0; i < post.media.length; i++) {
          const item = post.media[i];
          output += `\n${i + 1}. **${item.type}**\n`;
          if (item.localPath && !item.localPath.startsWith("[")) {
            output += `   Local: ${item.localPath}\n`;
          }
          output += `   URL: ${item.url}\n`;
          if (item.localPath?.startsWith("[")) {
            output += `   ${item.localPath}\n`;
          }
        }
      }

      if (post.videoTranscription) {
        output += `\n**Video Transcription:**\n${post.videoTranscription}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error fetching Instagram post: ${message}` }],
        isError: true,
      };
    }
  }
);


server.tool(
  "extract_video_frames",
  "Extract frames from any video as images. Supports YouTube, Instagram, Twitter, TikTok, and direct video URLs. Downloads the video, extracts frames at a specified rate (e.g., 1 frame/sec or 2 frames/sec), and saves them to a local folder. Returns file paths so Claude can read/analyze each frame visually. Supports optional start/end times in seconds to extract only a portion of the video.",
  {
    url: z.string().describe("Video URL (YouTube, Instagram, Twitter, TikTok, or direct MP4 URL)"),
    fps: z.number().default(1).describe("Frames per second to extract. 1 = one frame per second, 2 = one frame every 0.5 seconds, 0.5 = one frame every 2 seconds. Default: 1"),
    start: z.number().optional().describe("Start time in seconds. Only extract frames from this point. Optional."),
    end: z.number().optional().describe("End time in seconds. Only extract frames up to this point. Optional."),
  },
  async ({ url, fps, start, end }) => {
    try {
      const result = await extractFrames(url, fps, start, end);

      let output = `**Video Frame Extraction**\n`;
      output += `**Source:** ${url}\n`;
      output += `**Video Duration:** ${result.videoDuration?.toFixed(1)}s\n`;
      output += `**FPS:** ${result.fps} (1 frame every ${(1 / result.fps).toFixed(1)}s)\n`;
      if (result.startSec !== undefined) output += `**Start:** ${result.startSec}s\n`;
      if (result.endSec !== undefined) output += `**End:** ${result.endSec}s\n`;
      output += `**Frames Extracted:** ${result.frameCount}\n`;
      output += `**Folder:** ${result.folder}\n`;

      output += `\n**Frames:**\n`;
      for (let i = 0; i < result.frames.length; i++) {
        const timeSec = (result.startSec ?? 0) + (i / result.fps);
        const mins = Math.floor(timeSec / 60);
        const secs = Math.floor(timeSec % 60);
        output += `${i + 1}. [${mins}:${secs.toString().padStart(2, "0")}] ${result.frames[i]}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error extracting frames: ${message}` }],
        isError: true,
      };
    }
  }
);


server.tool(
  "fetch_markdown",
  "Extract clean markdown from any webpage using Cloudflare Browser Run. Works on JS-heavy pages, SPAs, and sites where simple fetch fails. Use as a fallback when WebFetch returns empty or broken content. Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars.",
  {
    url: z.string().describe("URL to extract markdown from (e.g. https://example.com/article)"),
    wait_for_js: z.boolean().default(false).describe("Wait for JavaScript to finish rendering (slower but needed for SPAs). Default: false"),
  },
  async ({ url, wait_for_js }) => {
    try {
      const result = await fetchMarkdown(url, wait_for_js);

      let output = `**Markdown extracted from:** ${result.url}\n\n`;
      output += result.markdown;

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error extracting markdown: ${message}` }],
        isError: true,
      };
    }
  }
);


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("media-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
