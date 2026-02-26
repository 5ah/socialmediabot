import type { TweetResult } from "./nitterSearch.js";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: {
    text: string;
    icon_url?: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
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
  const info = (tweet as any).accountInfo;

  // 1. Determine Color & Title Prefix
  let color = 0x1da1f2; // Default Blue
  let titlePrefix = "New Tweet";

  if (label?.toLowerCase().includes("traction")) {
    color = 0xff4500; // Orange-Red for Heat/Traction
    titlePrefix = "🔥 High Traction";
  } else if (label?.toLowerCase().includes("link")) {
    color = 0x2ecc71; // Green for Links
    titlePrefix = "🔗 Site Link";
  } else if (label) {
    titlePrefix = `📢 ${label}`;
  }

  // 2. Build Description
  // Truncate text if too long
  const text = tweet.text.length > 300 ? tweet.text.slice(0, 297) + "..." : tweet.text;

  // 3. Build Fields
  const fields = [];

  // Stats Bar: [ ❤️ 12 | 🔁 5 | 💬 2 ] + [ 👥 1.2k Followers ]
  const statsParts = [];
  if (tweet.likes) statsParts.push(`❤️ ${tweet.likes}`);
  if (tweet.retweets) statsParts.push(`🔁 ${tweet.retweets}`);
  if (tweet.replies) statsParts.push(`💬 ${tweet.replies}`);

  if (statsParts.length > 0) {
    fields.push({
      name: "📊 Engagement",
      value: statsParts.join("   "),
      inline: true
    });
  }

  // Account Status
  if (info) {
    const statusParts = [];

    // Followers count if not already shown? Let's put followers in its own mini-section or combine
    if (typeof info.followersCount === "number") {
      fields.push({
        name: "👥 Audience",
        value: `${info.followersCount.toLocaleString()} Followers`,
        inline: true
      });
    }

    // Network / Follows
    if (info.followsUs !== undefined || info.networkStatus) {
      let statusLine = "";

      // Network Icon
      if (info.networkStatus === "In-Network") statusLine += "🟢 In-Network";
      else if (info.networkStatus === "Out-of-Network") statusLine += "🔴 Out-of-Network";
      else statusLine += "❓ Unknown Network";

      // Follows Us
      if (info.followsUs === true) statusLine += " • ✅ Follows Us";
      else if (info.followsUs === false) statusLine += " • ❌ Not Following";

      fields.push({
        name: "🛡️ Intelligence",
        value: statusLine,
        inline: false
      });
    }
  }

  // 4. Construct Embed
  const embed: DiscordEmbed = {
    title: titlePrefix, // e.g. "🔥 High Traction" or "📢 Main Keywords"
    url: xUrl,
    description: text,
    color: color,
    timestamp: tweet.createdAt,
    author: {
      name: `${tweet.authorName || "Unknown"} (@${tweet.authorHandle?.replace("@", "")})`,
      url: tweet.authorHandle ? `https://x.com/${tweet.authorHandle.replace("@", "")}` : undefined,
      icon_url: info?.avatarUrl // Use enriched avatar if available
    },
    footer: {
      text: "Social Signals Bot",
      icon_url: "https://abs.twimg.com/icons/apple-touch-icon-192x192.png" // Generic Twitter icon or bot icon
    },
    fields: fields
  };

  const payload: DiscordWebhookPayload = {
    embeds: [embed],
    username: "Social Signals Bot", // Can customize this
    // avatar_url: ... // Can customize bot avatar
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
  } catch (err) {
    console.error(`[ERROR] Stats posting to Discord:`, err);
  }
}
