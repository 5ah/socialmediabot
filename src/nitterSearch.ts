import * as cheerio from "cheerio";

export type TweetResult = {
  id: string;
  url: string;
  text: string;
  createdAt?: string;
  authorHandle?: string;
  authorName?: string;
  replies?: number;
  retweets?: number;
  quotes?: number;
  likes?: number;
  matchedKeywords?: string[];
  matchedDomains?: string[];
};

export type SearchResponse = {
  query: string;
  instanceUsed: string;
  fetchedAt: string;
  results: TweetResult[];
  error?: string;
};

type FetchOptions = {
  instances: string[];
  timeoutMs: number;
  retriesPerInstance: number;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function cleanInstances(instances: string[]): string[] {
  return instances
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\/+$/, ""));
}

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/,/g, "");
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtmlWithFallback(
  pathOrUrl: string,
  opts: FetchOptions,
): Promise<{ html: string; instanceUsed: string; finalUrl: string }> {
  const instances = cleanInstances(opts.instances);
  if (instances.length === 0) {
    throw new Error(
      "No Nitter instances provided. Set NITTER_INSTANCES in .env or pass --instances",
    );
  }

  const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
  const path = isAbsolute ? new URL(pathOrUrl).pathname + new URL(pathOrUrl).search : pathOrUrl;

  let lastError: unknown;

  for (const base of instances) {
    const url = isAbsolute ? pathOrUrl : `${base}${path.startsWith("/") ? "" : "/"}${path}`;

    for (let attempt = 0; attempt <= opts.retriesPerInstance; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const html = await res.text();

        // Check for empty body or "verifying browser" page
        if (!html || html.length < 100) {
          throw new Error(`Empty or invalid response (${html.length} bytes)`);
        }

        if (html.includes("Verifying your browser")) {
          throw new Error("Got 'Verifying your browser' challenge");
        }

        return { html, instanceUsed: base, finalUrl: res.url };
      } catch (err) {
        lastError = err;
        if (attempt < opts.retriesPerInstance) {
          await sleep(250 * (attempt + 1));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : `Unknown error: ${String(lastError)}`;
  throw new Error(`All Nitter instances failed. Last error: ${msg}`);
}

function extractTweetsFromHtml(html: string, baseUsed: string): TweetResult[] {
  const $ = cheerio.load(html);
  const tweets: TweetResult[] = [];

  $(".timeline-item").each((_, el) => {
    const container = $(el);

    // Filter to actual tweets; Nitter sometimes includes "show-more" and other items.
    const contentEl = container.find(".tweet-content").first();
    const text = contentEl.text().trim();
    if (!text) return;

    const dateLink = container.find(".tweet-date a").first();
    const href = dateLink.attr("href") || "";

    const url = href
      ? href.startsWith("http")
        ? href
        : `${baseUsed}${href.startsWith("/") ? "" : "/"}${href}`
      : "";

    const id = url ? url.split("/").pop() || url : text.slice(0, 32);

    const createdAtTitle = dateLink.attr("title");
    let createdAt: string | undefined = undefined;
    if (createdAtTitle) {
      // Nitter format: "Jan 19, 2026 · 3:55 PM UTC" - convert · to space for better parsing
      const normalized = createdAtTitle.replace(" · ", " ");
      const d = new Date(normalized);
      if (!Number.isNaN(d.getTime())) {
        createdAt = d.toISOString();
      }
    }

    const authorHandle = container.find(".username").first().text().trim() || undefined;
    const authorName = container.find(".fullname").first().text().trim() || undefined;

    const stats = container.find(".tweet-stats");
    const replies = parseCount(stats.find(".icon-comment").closest(".icon-container").parent().text());
    const retweets = parseCount(stats.find(".icon-retweet").closest(".icon-container").parent().text());
    const quotes = parseCount(stats.find(".icon-quote").closest(".icon-container").parent().text());
    const likes = parseCount(stats.find(".icon-heart").closest(".icon-container").parent().text());

    tweets.push({
      id,
      url,
      text,
      createdAt,
      authorHandle,
      authorName,
      replies,
      retweets,
      quotes,
      likes,
    });
  });

  return tweets;
}

function extractShowMorePath(html: string): string | undefined {
  const $ = cheerio.load(html);
  const href = $("a.show-more").attr("href");
  if (!href) return undefined;
  // Usually a relative URL like: /search?f=tweets&q=...&cursor=...
  return href.startsWith("http") ? new URL(href).pathname + new URL(href).search : href;
}

export async function searchNitterGlobal(
  query: string,
  limit: number,
  opts: FetchOptions,
): Promise<SearchResponse> {
  const results: TweetResult[] = [];

  const firstPath = `/search?f=tweets&q=${encodeURIComponent(query)}`;

  let nextPath: string | undefined = firstPath;
  let instanceUsedForLastFetch = "";

  try {
    // Hard safety limit on pages so we don't loop forever.
    for (let page = 0; page < 10 && nextPath && results.length < limit; page++) {
      const { html, instanceUsed } = await fetchHtmlWithFallback(nextPath, opts);
      instanceUsedForLastFetch = instanceUsed;

      const pageTweets = extractTweetsFromHtml(html, instanceUsed);
      for (const t of pageTweets) {
        if (results.length >= limit) break;
        // Deduplicate within this run
        if (results.some((r) => r.id === t.id)) continue;
        results.push(t);
      }

      nextPath = results.length < limit ? extractShowMorePath(html) : undefined;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      query,
      instanceUsed: instanceUsedForLastFetch || cleanInstances(opts.instances)[0] || "",
      fetchedAt: new Date().toISOString(),
      results,
      error: `Failed after fetching ${results.length} results: ${errorMsg}`,
    };
  }

  return {
    query,
    instanceUsed: instanceUsedForLastFetch || cleanInstances(opts.instances)[0] || "",
    fetchedAt: new Date().toISOString(),
    results,
  };
}
