import "dotenv/config";
import { searchNitterGlobal } from "./nitterSearch.js";
import { postToDiscord } from "./discord.js";
import { checkVips } from "./vipTracker.js";
import { enrichTweets } from "./enrichment.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const STATE_FILE = ".state.json";

type MonitorState = {
  lastIds: Record<string, string[]>; // monitorKey -> seenIds[]
};

function loadState(): MonitorState {
  const stateFile = resolve(process.cwd(), STATE_FILE);
  if (!existsSync(stateFile)) {
    return { lastIds: {} };
  }
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const json = JSON.parse(raw);
    // Migration from old state format
    if (json.seenIds && Array.isArray(json.seenIds)) {
      return { lastIds: { "default": json.seenIds } };
    }
    return json;
  } catch {
    return { lastIds: {} };
  }
}

function saveState(state: MonitorState): void {
  const stateFile = resolve(process.cwd(), STATE_FILE);
  writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
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

// --- Monitor Logic ---

type MonitorConfig = {
  key: string;
  query: string;
  label: string;
};

async function processMonitor(monitor: MonitorConfig, state: MonitorState, webhookUrl: string, globalOpts: any) {
  console.log(`[INFO] Checking monitor: ${monitor.label} (Query: ${monitor.query})`);

  // Initialize state for this monitor if not exists
  if (!state.lastIds[monitor.key]) {
    state.lastIds[monitor.key] = [];
  }

  const seenIds = state.lastIds[monitor.key];

  // TODO: We technically discard keywords/domains logic here for custom monitors (traction/links)
  // because the query itself handles it. But for the "Main" monitor, we might want to keep the old logic?
  // For simplicity, we assume the QUERY does the heavy lifting now.
  // If the Main monitor relies on client-side filtering (keywords list), we should apply that ONLY to main monitor.

  const res = await searchNitterGlobal(monitor.query, 50, globalOpts); // Hardcoded limit 50 for monitors

  if (res.error) {
    console.error(`[ERROR] Monitor ${monitor.label} failed: ${res.error}`);
    return;
  }

  // Filter seen
  const unseenTweets = res.results.filter(t => !seenIds.includes(t.id));

  // Filter by Freshness (ignore tweets older than 24h)
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const newTweets = unseenTweets.filter(t => {
    if (!t.createdAt) return true; // Keep if no date (safe fallback)
    const tweetDate = new Date(t.createdAt).getTime();
    const age = now - tweetDate;
    if (age > ONE_DAY_MS) {
      // It's too old, but mark it as seen so we don't re-process it
      seenIds.push(t.id);
      return false;
    }
    return true;
  });

  if (newTweets.length > 0) {
    console.log(`[INFO] ${monitor.label}: Found ${newTweets.length} new tweet(s)`);

    // Enrich tweets if API key is present
    let tweetsToPost = newTweets;
    if (process.env.TWITTER_API_IO_KEY) {
      try {
        tweetsToPost = await enrichTweets(newTweets);
      } catch (err) {
        console.error(`[WARN] Enrichment failed for ${monitor.label}, posting unenriched:`, err);
      }
    }

    for (const tweet of tweetsToPost) {
      try {
        // Post to Discord with the monitor label (e.g. "High Traction Replies")
        await postToDiscord(webhookUrl, tweet, monitor.label);
        console.log(`[SUCCESS] Posted ${tweet.id}`);
        seenIds.push(tweet.id);
      } catch (err) {
        console.error(`[ERROR] Failed to post ${tweet.id}:`, err);
      }
    }
  }

  // Trim state
  if (seenIds.length > 5000) {
    state.lastIds[monitor.key] = seenIds.slice(-5000);
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
      // Updated default: Prioritize the handle or exact phrase, exclude common noise?
      // User complaint: "Canada spends billions" -> matches "Canada Spends".
      // Fix: Use "@CanadaSpends" OR "CanadaSpends" (one word) OR exact phrase with quotes but be careful.
      // Safest noise-free default: just the handle and single word project name.
      query: process.env.DEFAULT_QUERY ?? '@CanadaSpends OR "CanadaSpends" OR url:canadaspends',
      label: "Main Keywords"
    },
    {
      key: "links",
      query: "url:canadaspends",
      label: "Site Links"
    },
    {
      key: "traction_replies",
      query: `(to:${mainAccount}) (min_faves:10 OR min_retweets:5)`,
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
