import { TweetResult } from "./nitterSearch.js";
import { TwitterApi, getUserInfo, checkFollows } from "./twitterApiIoClient.js";

const MAIN_ACCOUNT = process.env.MAIN_ACCOUNT_HANDLE;

export type AccountInfo = {
  followersCount?: number;
  followingCount?: number;
  followsUs?: boolean;
  networkStatus?: "In-Network" | "Out-of-Network" | "Unknown";
  isVip?: boolean;
};

export type EnrichedTweet = TweetResult & {
  accountInfo?: AccountInfo;
};

/**
 * Enriches a list of Nitter tweets with account info from twitterapi.io.
 * This is done in batch (parallel promises) but should be rate-limited in production.
 */
export async function enrichTweets(tweets: TweetResult[]): Promise<EnrichedTweet[]> {
  if (!MAIN_ACCOUNT) {
    console.warn("MAIN_ACCOUNT_HANDLE not set. Skipping 'follows us' checks.");
  }

  // Deduplicate authors to save API calls
  const authors = Array.from(new Set(tweets.map((t) => t.authorHandle).filter((h): h is string => !!h)));

  // Create a map of handle -> AccountInfo
  const accountInfoMap = new Map<string, AccountInfo>();

  // Fetch info for each unique author
  // TODO: Add concurrency limit if authors.length is huge
  await Promise.all(
    authors.map(async (handle) => {
      try {
        const cleanHandle = handle.replace(/^@/, "");

        // 1. Get User Info
        const info = await getUserInfo(cleanHandle);

        let followsUs = false;
        let networkStatus: AccountInfo["networkStatus"] = "Unknown";

        // 2. Check "Follows Us" (if Main Account is set)
        if (MAIN_ACCOUNT && cleanHandle.toLowerCase() !== MAIN_ACCOUNT.toLowerCase()) {
          // Optimization: Only check if we are smaller? Or just check always?
          // User said: "in/out of network if they are smaller than us, if bigger, they are always out of network"

          // We need "Our" info to compare size. 
          // Ideally we cache "Our" info globally once per run.
          // For now, let's assume we don't have "Our" info cached yet.

          // Let's implement the simpler "Follows Us" check first.
          followsUs = await checkFollows(cleanHandle, MAIN_ACCOUNT);
        }

        // 3. Determine Network Status
        // Logic: "in/out of network if they are smaller than us [and follow us? Or overlap?]"
        // User said: "based on follower overlap... (although this might be really expensive)"
        // Simplified mapping for now:
        if (followsUs) {
          networkStatus = "In-Network";
        } else {
          // If they don't follow us, they are out of network
          networkStatus = "Out-of-Network";
        }

        accountInfoMap.set(handle, {
          followersCount: info.followers_count,
          followingCount: info.following_count,
          followsUs,
          networkStatus,
        });

      } catch (err) {
        console.error(`Failed to enrich ${handle}:`, err);
        // Set empty info or mark/error
        accountInfoMap.set(handle, { networkStatus: "Unknown" });
      }
    })
  );

  // Merge back into tweets
  return tweets.map((t) => {
    return {
      ...t,
      accountInfo: t.authorHandle ? accountInfoMap.get(t.authorHandle) : undefined,
    };
  });
}
