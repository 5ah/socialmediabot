import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { getUserInfo, checkFollows } from "./twitterApiIoClient.js";

const VIP_LIST_PATH = process.env.VIP_LIST_PATH || "./vip_list.json";
const STATE_FILE_PATH = "./.vip_state.json";
const MAIN_ACCOUNT = process.env.MAIN_ACCOUNT_HANDLE;

type VipItem = {
  handle: string;
  name?: string;
  category?: string; // e.g. "MP", "Journalist"
};

type VipState = {
  lastChecked: string;
  followingHandles: string[];
};

async function loadVips(): Promise<VipItem[]> {
  try {
    const raw = await fs.readFile(VIP_LIST_PATH, "utf-8");
    const json = JSON.parse(raw);

    if (!Array.isArray(json)) {
      throw new Error("VIP list must be a JSON array");
    }

    return json.map((item: any) => {
      if (typeof item === "string") {
        return { handle: item.replace(/^@/, "") };
      }
      return {
        handle: item.handle?.replace(/^@/, ""),
        name: item.name,
        category: item.category
      };
    }).filter((i) => !!i.handle);

  } catch (err) {
    console.error(`Failed to load VIP list from ${VIP_LIST_PATH}:`, err);
    return [];
  }
}

async function loadState(): Promise<VipState> {
  try {
    const raw = await fs.readFile(STATE_FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastChecked: "", followingHandles: [] };
  }
}

async function saveState(state: VipState) {
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  if (!MAIN_ACCOUNT) {
    console.error("MAIN_ACCOUNT_HANDLE is not set in .env");
    process.exit(1);
  }

  if (!process.env.TWITTER_API_IO_KEY) {
    console.error("TWITTER_API_IO_KEY is not set in .env");
    process.exit(1);
  }

  const vips = await loadVips();
  const state = await loadState();

  console.log(`Loaded ${vips.length} VIPs from list.`);
  console.log(`Checking which VIPs follow @${MAIN_ACCOUNT}...`);

  const currentFollowingHandles: string[] = [];
  const results: any[] = [];
  const newFollowers: string[] = [];

  // TODO: Concurrency control
  for (const vip of vips) {
    try {
      // process.stdout.write(`Checking ${vip.handle}... `);
      const follows = await checkFollows(vip.handle, MAIN_ACCOUNT);

      if (follows) {
        currentFollowingHandles.push(vip.handle);

        // Check if new
        if (!state.followingHandles.includes(vip.handle)) {
          console.log(`\n🎉 NEW FOLLOWER DETECTED: ${vip.handle} (${vip.name || "No Name"})`);
          newFollowers.push(vip.handle);
        } else {
          // Already known
          // console.log(`(Matches)`);
        }
      } else {
        process.stdout.write(".");
      }

      results.push({
        ...vip,
        followsUs: follows,
      });

    } catch (err) {
      if (err instanceof Error && err.message.includes("429")) {
        console.log("Status 429 (Too Many Requests), waiting 30s...");
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
      results.push({ ...vip, error: String(err) });
    }
    // Add delay to avoid 429 (5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Save new state
  await saveState({
    lastChecked: new Date().toISOString(),
    followingHandles: currentFollowingHandles
  });

  console.log("\n\n=== VIP Report ===");
  const followers = results.filter(r => r.followsUs);

  if (newFollowers.length > 0) {
    console.log(`\n🚨 NEW FOLLOWERS SINCE LAST CHECK:`);
    newFollowers.forEach(h => console.log(` - ${h}`));
    console.log("");
  } else {
    console.log("\nNo new VIP followers since last check.\n");
  }

  console.log(`Total VIP Followers: ${followers.length} / ${vips.length}`);
  if (followers.length > 0) {
    console.table(followers.map(f => ({
      Handle: f.handle,
      Name: f.name,
      Category: f.category,
      Status: newFollowers.includes(f.handle) ? "🎉 NEW" : "Existing"
    })));
  }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadVips, main as checkVips };
