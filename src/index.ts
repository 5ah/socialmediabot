/// <reference types="node" />
import "dotenv/config";
import { searchNitterGlobal } from "./nitterSearch.js";

function readArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function readFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseKeywords(args: string[]): string[] {
  const fromArg = readArgValue(args, "--keywords");
  const fromEnv = process.env.KEYWORDS;
  const raw = fromArg ?? fromEnv ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function matchKeywords(text: string, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw));
}

function parseDomains(args: string[]): string[] {
  const fromArg = readArgValue(args, "--domains");
  const fromEnv = process.env.DOMAINS;
  const raw = fromArg ?? fromEnv ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchDomains(text: string, url: string | undefined, domains: string[]): string[] {
  if (!domains.length) return [];
  const lowerText = text.toLowerCase();
  const lowerUrl = url?.toLowerCase() ?? "";
  return domains.filter((d) => lowerText.includes(d) || lowerUrl.includes(d));
}

function parseBlacklist(args: string[]): string[] {
  const fromArg = readArgValue(args, "--blacklist");
  const fromEnv = process.env.BLACKLIST_ACCOUNTS;
  const raw = fromArg ?? fromEnv ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

function isBlacklisted(authorHandle: string | undefined, blacklist: string[]): boolean {
  if (!blacklist.length || !authorHandle) return false;
  const handle = authorHandle.toLowerCase().replace(/^@/, "");
  return blacklist.includes(handle);
}

function getInstances(args: string[]): string[] {
  const fromArg = readArgValue(args, "--instances");
  const fromEnv = process.env.NITTER_INSTANCES;
  const raw = fromArg ?? fromEnv ?? "";
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parsed.length > 0) return parsed;

  return [
    "https://nitter.net",
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
  ];
}

import { enrichTweets } from "./enrichment.js";

// ... existing imports

// ... existing helper functions

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const query =
    readArgValue(args, "--q") ??
    process.env.DEFAULT_QUERY ??
    process.env.QUERY ??
    "";

  if (!query) {
    console.error(
      "Missing query. Usage: npm run dev -- --q \"Build Canada\" --limit 20",
    );
    process.exit(2);
  }

  const limit = parseIntSafe(
    readArgValue(args, "--limit") ?? process.env.DEFAULT_LIMIT,
    20,
  );

  const timeoutMs = parseIntSafe(process.env.TIMEOUT_MS, 10000);
  const retriesPerInstance = parseIntSafe(process.env.RETRIES_PER_INSTANCE, 1);
  const keywords = parseKeywords(args);
  const domains = parseDomains(args);
  const blacklist = parseBlacklist(args);

  const instances = getInstances(args);

  const res = await searchNitterGlobal(query, limit, {
    instances,
    timeoutMs,
    retriesPerInstance,
  });

  const filtered = (keywords.length || domains.length)
    ? res.results
      .filter((t) => !isBlacklisted(t.authorHandle, blacklist))
      .map((t) => {
        const matched = matchKeywords(t.text, keywords);
        const matchedDomains = matchDomains(t.text, t.url, domains);
        return matched.length || matchedDomains.length
          ? { ...t, matchedKeywords: matched.length ? matched : undefined, matchedDomains: matchedDomains.length ? matchedDomains : undefined }
          : null;
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
    : res.results.filter((t) => !isBlacklisted(t.authorHandle, blacklist));

  // --- ENRICHMENT STEP ---
  // Only enrich if TWITTER_API_IO_KEY is set.
  // We can also add a flag to skip enrichment if needed, e.g. --no-enrich
  let finalResults = filtered;
  if (process.env.TWITTER_API_IO_KEY && !readFlag(args, "--no-enrich")) {
    // console.error("Enriching results with Twitter API..."); // Optional logging to stderr
    finalResults = await enrichTweets(filtered);
  }

  const pretty = !readFlag(args, "--compact");
  process.stdout.write(
    JSON.stringify({
      ...res,
      results: finalResults,
      keywordsApplied: keywords,
      domainsApplied: domains,
    }, null, pretty ? 2 : 0) + "\n",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
