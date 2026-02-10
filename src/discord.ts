import type { TweetResult } from "./nitterSearch.js";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: {
    text: string;
  };
  author?: {
    name: string;
    url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
};

export type DiscordWebhookPayload = {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
};

function toXUrl(tweet: TweetResult): string | undefined {
  if (tweet.url) {
    try {
      const u = new URL(tweet.url);
      // Preserve the path, drop any hash, force x.com host
      return `https://x.com${u.pathname}`;
    } catch {
      // fall through to handle-based construction
    }
  }

  if (tweet.authorHandle && tweet.id) {
    const cleanId = tweet.id.split("#")[0];
    const handle = tweet.authorHandle.replace(/^@/, "");
    return `https://x.com/${handle}/status/${cleanId}`;
  }

  return tweet.url;
}

export async function postToDiscord(
  webhookUrl: string,
  tweet: TweetResult,
  label?: string,
): Promise<void> {
  const xUrl = toXUrl(tweet);

  // Custom Title based on label
  let titlePrefix = "New mention";
  if (label?.includes("Traction")) titlePrefix = "🔥 High Traction";
  else if (label?.includes("Link")) titlePrefix = "🔗 Site Link";
  else if (label) titlePrefix = `📢 ${label}`;

  const embed: DiscordEmbed = {
    title: `${titlePrefix} from ${tweet.authorName || tweet.authorHandle || "Unknown"}`,
    description: tweet.text.length > 300 ? tweet.text.slice(0, 297) + "..." : tweet.text,
    url: xUrl,
    color: 0x1da1f2, // X blue
    timestamp: tweet.createdAt,
    author: tweet.authorHandle
      ? {
        name: tweet.authorHandle,
        url: `https://x.com/${tweet.authorHandle.replace("@", "")}`,
      }
      : undefined,
    fields: [],
  };

  if (tweet.matchedKeywords && tweet.matchedKeywords.length > 0) {
    embed.fields?.push({
      name: "🔍 Keywords",
      value: tweet.matchedKeywords.join(", "),
      inline: true,
    });
  }

  if (tweet.matchedDomains && tweet.matchedDomains.length > 0) {
    embed.fields?.push({
      name: "🌐 Domains",
      value: tweet.matchedDomains.join(", "),
      inline: true,
    });
  }

  const stats: string[] = [];
  if (tweet.replies) stats.push(`💬 ${tweet.replies}`);
  if (tweet.retweets) stats.push(`🔁 ${tweet.retweets}`);
  if (tweet.likes) stats.push(`❤️ ${tweet.likes}`);

  // ... existing stats code ...
  if (stats.length > 0) {
    embed.fields?.push({
      name: "📊 Engagement",
      value: stats.join("  "),
      inline: false,
    });
  }

  // --- Account Info (Enriched) ---
  // We assume tweet is EnrichedTweet (has accountInfo optional)
  const info = (tweet as any).accountInfo;
  if (info) {
    const parts: string[] = [];

    // Followers
    if (typeof info.followersCount === "number") {
      parts.push(`**Followers:** ${info.followersCount.toLocaleString()}`);
    }

    // Follows Us
    if (info.followsUs === true) {
      parts.push(`**Follows Us:** ✅ YES`);
    } else if (info.followsUs === false) {
      parts.push(`**Follows Us:** ❌ NO`);
    }

    // Network Status
    if (info.networkStatus) {
      let statusIcon = "❓";
      if (info.networkStatus === "In-Network") statusIcon = "🟢";
      if (info.networkStatus === "Out-of-Network") statusIcon = "🔴";

      parts.push(`**Status:** ${statusIcon} ${info.networkStatus}`);
    }

    if (parts.length > 0) {
      embed.fields?.push({
        name: "👤 Account Intel",
        value: parts.join("\n"),
        inline: false
      });
    }
  }

  const payload: DiscordWebhookPayload = {
    embeds: [embed],
    username: "Social Signals Bot",
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Discord webhook failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }
}
