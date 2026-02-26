import "dotenv/config";
import { searchNitterGlobal } from "./nitterSearch.js";
import { postToDiscord } from "./discord.js";
import { checkVips } from "./vipTracker.js";
import { enrichTweets } from "./enrichment.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const STATE_FILE = ".state.json";

type TweetStats = {
  likes: number;
  retweets: number;
  replies: number;
  lastChecked: number;
};

type MonitorState = {
  // Tweet ID -> Stats (Global for all monitors)
  seenTweets: Record<string, TweetStats>;
};

function loadState(): MonitorState {
  const stateFile = resolve(process.cwd(), STATE_FILE);
  if (!existsSync(stateFile)) {
    return { seenTweets: {} };
  }
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const json = JSON.parse(raw);

    // Migration: If old format "lastIds", convert it
    if (json.lastIds) {
      const newState: MonitorState = { seenTweets: {} };
      for (const [key, ids] of Object.entries(json.lastIds)) {
        if (Array.isArray(ids)) {
          ids.forEach((id: string) => {
            // Dummy stats for migrated IDs so we don't re-alert immediately
            newState.seenTweets[id] = { likes: 0, retweets: 0, replies: 0, lastChecked: Date.now() };
          });
        }
      }
      return newState;
    }

    // Migration: If old format "monitorKey -> { tweetId -> Stats }", flatten it
    // Check if the first key in seenTweets is a monitor key (e.g. "default", "links") that contains an object of tweets
    const keys = Object.keys(json.seenTweets || {});
    if (keys.length > 0) {
      const firstVal = json.seenTweets[keys[0]];
      // If the value is an object but NOT a TweetStats (i.e. doesn't have 'likes'), it's likely a nested map
      if (firstVal && typeof firstVal === 'object' && !('likes' in firstVal)) {
        console.log("[INFO] Migrating state from per-monitor to global...");
        const newState: MonitorState = { seenTweets: {} };
        for (const monitorKey in json.seenTweets) {
          const tweets = json.seenTweets[monitorKey];
          for (const tweetId in tweets) {
            // If we have seen it in multiple monitors, keep the most recent "lastChecked" ideally, 
            // but simply overwriting is fine as long as we keep it "seen".
            newState.seenTweets[tweetId] = tweets[tweetId];
          }
        }
        return newState;
      }
    }

    return json;
  } catch {
    return { seenTweets: {} };
  }
}


function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase());
}

function parseDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function parseBlacklist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

function getInstances(raw: string | undefined): string[] {
  if (!raw) {
    return [
      "https://nitter.net",
      "https://nitter.poast.org",
      "https://nitter.privacydev.net",
    ];
  }
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : ["http://localhost:8080"];
}

function matchKeywords(text: string, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw));
}

function matchDomains(text: string, url: string | undefined, domains: string[]): string[] {
  if (!domains.length) return [];
  const lowerText = text.toLowerCase();
  const lowerUrl = url?.toLowerCase() ?? "";
  return domains.filter((d) => lowerText.includes(d) || lowerUrl.includes(d));
}

function isBlacklisted(authorHandle: string | undefined, blacklist: string[]): boolean {
  if (!blacklist.length || !authorHandle) return false;
  const handle = authorHandle.toLowerCase().replace(/^@/, "");
  return blacklist.includes(handle);
}

function saveState(state: MonitorState): void {
  const stateFile = resolve(process.cwd(), STATE_FILE);
  writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
}

type MonitorConfig = {
  key: string;
  query: string;
  label: string;
};


async function processMonitor(monitor: MonitorConfig, state: MonitorState, webhookUrl: string, globalOpts: any) {
  console.log(`[INFO] Checking monitor: ${monitor.label} (Query: ${monitor.query})`);

  const seenMap = state.seenTweets; // Global map
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // Prune old tweets from state (only do this once per cycle ideally, but okay here for now)
  // We can just skip pruning here and rely on the global loop or just let it be.
  // Actually, to avoid iterating the WHOLE map for every monitor, let's skip pruning inside the monitor loop.
  // We should move pruning to the main loop or just do it less often.
  // For now, let's just LEAVE IT but be aware it iterates everything.
  // actually, let's move pruning out. 
  // But to keep changes minimal matching the plan:
  // We will just use `seenMap` which is now `state.seenTweets`.


  const res = await searchNitterGlobal(monitor.query, 50, globalOpts);

  if (res.error) {
    console.error(`[ERROR] Monitor ${monitor.label} failed: ${res.error}`);
    return;
  }

  // Traction Settings
  const TRACTION_THRESHOLD_LIKES = parseIntSafe(process.env.TRACTION_THRESHOLD_LIKES, 5);
  const TRACTION_GROWTH_PERCENT = 0.5; // 50% growth to re-alert

  for (const tweet of res.results) {
    // 1. Check Age (Skip if > 3 days old absolute time)
    if (tweet.createdAt) {
      const tweetTime = new Date(tweet.createdAt).getTime();
      if (now - tweetTime > THREE_DAYS_MS) continue;
    }

    const currentLikes = tweet.likes || 0;
    const currentRTs = tweet.retweets || 0;

    const isSeen = !!seenMap[tweet.id];
    const prevStats = seenMap[tweet.id] || { likes: 0, retweets: 0, replies: 0, lastChecked: 0 };

    let shouldAlert = false;
    let alertReason = "";

    if (!isSeen) {
      // NEW TWEET
      // Alert if it meets baseline traction immediately (optional, or just alert all?)
      // For "High Traction" monitor, the query itself filters for >10 likes.
      // For "Keywords", we might want to see EVERYTHING.

      // logic: If monitor is "High Traction", we always alert new stuff.
      // If monitor is "Keywords", we alert everything.
      shouldAlert = true;
      alertReason = "New Tweet found";

    } else {
      // PREVIOUSLY SEEN - Check for Growth
      // Only check if it satisfies a minimum baseline to avoid noise (e.g. 2 likes -> 3 likes)
      if (currentLikes >= TRACTION_THRESHOLD_LIKES) {
        const growth = (currentLikes - prevStats.likes) / (prevStats.likes || 1);

        if (growth >= TRACTION_GROWTH_PERCENT && (currentLikes - prevStats.likes) >= 5) {
          shouldAlert = true;
          alertReason = `🚀 Traction Spike: Likes grew from ${prevStats.likes} to ${currentLikes}`;
        }
      }
    }

    if (shouldAlert) {
      console.log(`[INFO] Alerting ${tweet.id}: ${alertReason}`);

      let tweetToPost = tweet;
      if (process.env.TWITTER_API_IO_KEY) {
        try {
          const enriched = await enrichTweets([tweet]);
          tweetToPost = enriched[0];
        } catch (err) {
          console.error(`[WARN] Enrichment failed for ${tweet.id}`);
        }
      }

      await postToDiscord(webhookUrl, tweetToPost, `${monitor.label} (${alertReason})`);
    }

    // Update State
    seenMap[tweet.id] = {
      likes: currentLikes,
      retweets: currentRTs,
      replies: tweet.replies || 0,
      lastChecked: now
    };
  }
}

async function runMonitors(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("[ERROR] DISCORD_WEBHOOK_URL not set");
    return;
  }

  const timeoutMs = parseIntSafe(process.env.TIMEOUT_MS, 10000);
  const retriesPerInstance = parseIntSafe(process.env.RETRIES_PER_INSTANCE, 1);
  const instances = getInstances(process.env.NITTER_INSTANCES);
  const globalOpts = { instances, timeoutMs, retriesPerInstance };

  const mainAccount = process.env.MAIN_ACCOUNT_HANDLE || "CanadaSpends";

  // Define Monitors
  const monitors: MonitorConfig[] = [
    {
      key: "default",

      query: (process.env.DEFAULT_QUERY ?? '@canada_spends OR "CanadaSpends" OR url:canadaspends') + ' -from:canada_spends',
      label: "Main Keywords"
    },
    {
      key: "links",
      query: "url:canadaspends -from:canada_spends",
      label: "Site Links"
    },
    {
      key: "traction_replies",
      query: `(to:${mainAccount}) (min_faves:10 OR min_retweets:5) -from:canada_spends`,
      label: "High Traction Replies"
    }
    // Add "mentions" if needed: `(to:${mainAccount} OR @${mainAccount}) ...`
  ];

  const state = loadState();

  for (const monitor of monitors) {
    await processMonitor(monitor, state, webhookUrl, globalOpts);
    // Small sleep between monitors to be nice to Nitter
    await new Promise(r => setTimeout(r, 2000));
  }

  saveState(state);
}

// --- Main Runner ---

async function run(): Promise<void> {
  const pollIntervalSeconds = parseIntSafe(process.env.POLL_INTERVAL_SECONDS, 120);
  const vipCheckIntervalSeconds = parseIntSafe(process.env.VIP_CHECK_INTERVAL_SECONDS, 3600);

  console.log(`[INFO] Starting worker`);
  console.log(`[INFO]   - Monitors Poll: every ${pollIntervalSeconds}s`);
  console.log(`[INFO]   - VIP Check: every ${vipCheckIntervalSeconds}s`);

  let lastVipCheck = 0;

  const doPoll = async () => {
    try {
      await runMonitors();
    } catch (err) {
      console.error("[ERROR] Monitor Poll failed:", err instanceof Error ? err.message : err);
    }
  };

  const doVipCheck = async () => {
    const now = Date.now();
    if (now - lastVipCheck >= vipCheckIntervalSeconds * 1000) {
      try {
        console.log("[INFO] Starting scheduled VIP check...");
        await checkVips();
        lastVipCheck = Date.now();
        console.log("[INFO] Scheduled VIP check complete.");
      } catch (err) {
        console.error("[ERROR] VIP check failed:", err instanceof Error ? err.message : err);
      }
    }
  };

  // Run immediately
  await doPoll();
  await doVipCheck();

  setInterval(async () => {
    await doPoll();
    await doVipCheck();
  }, pollIntervalSeconds * 1000);
}

run().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
