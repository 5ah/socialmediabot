import "dotenv/config";

const BASE_URL = "https://api.twitterapi.io/twitter";
const API_KEY = process.env.TWITTER_API_IO_KEY;

type UserInfo = {
  id: string;
  userName: string;
  name: string;
  followers_count: number;
  following_count: number;
  is_verified?: boolean;
  description?: string;
  location?: string;
  profile_image_url?: string;
};

type FollowersResponse = {
  followers: UserInfo[];
  next_cursor?: string;
  has_next_page: boolean;
};

type FollowingResponse = {
  following: UserInfo[];
  next_cursor?: string;
  has_next_page: boolean;
};

async function fetchTwitterApi(path: string, params: Record<string, string> = {}): Promise<any> {
  if (!API_KEY) {
    throw new Error("TWITTER_API_IO_KEY is not set in .env");
  }

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      "X-API-Key": API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`TwitterAPI.io Error ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Get user information by screen name (handle).
 */
export async function getUserInfo(userName: string): Promise<UserInfo> {
  // Endpoint: /user/info?userName=...
  const raw = await fetchTwitterApi("/user/info", { userName });

  if (!raw || !raw.data) {
    throw new Error(`Invalid response for user ${userName}`);
  }

  const d = raw.data;

  // Map the API fields to our UserInfo type
  // API returns "followers", we want "followers_count" (or we update type)
  // API returns "following", we want "following_count"
  return {
    id: d.id,
    userName: d.userName,
    name: d.name,
    followers_count: d.followers ?? 0,
    following_count: d.following ?? 0,
    is_verified: d.isVerified || d.isBlueVerified,
    description: d.description,
    location: d.location?.trim() || undefined,
    profile_image_url: d.profilePicture || d.profile_image_url_https,
  };
}

/**
 * Get a user's ID by screen name if not already known.
 * Often needed for other endpoints.
 */
export async function getUserId(userName: string): Promise<string> {
  const info = await getUserInfo(userName);
  return info.id;
}

/**
 * Check if 'follower' follows 'target'.
 * This is "expensive" without a direct friendship endpoint, so we use strategies.
 * Strategy 1: Fetch target's followers (if target is small).
 * Strategy 2: Fetch follower's following (if follower follows few).
 * 
 * For now, we return a "best effort" check using pagination.
 * WARNING: This can consume many API credits. Use with caution.
 */
export async function checkFollows(followerHandle: string, targetHandle: string): Promise<boolean> {
  // TODO: Implement smart checking.
  // For MVP, we might just assume "unknown" or strictly use the smaller list.

  // Let's implement a safe check: fetch the first page of "followings" of the follower
  // to see if the target is recently followed.
  try {
    // Official doc uses plural 'followings' and pageSize
    const res = await fetchTwitterApi("/user/followings", {
      userName: followerHandle,
      pageSize: "100" // Check last 100 people they followed
    });

    // API might return { followings: [...] } or { data: { followings: [...] } } or { following: [...] }
    // We try to find the array.
    let list: UserInfo[] = [];
    if (res.followings && Array.isArray(res.followings)) list = res.followings;
    else if (res.following && Array.isArray(res.following)) list = res.following;
    else if (res.data?.followings && Array.isArray(res.data.followings)) list = res.data.followings;
    else if (res.data?.following && Array.isArray(res.data.following)) list = res.data.following;

    if (list.length > 0) {
      const found = list.some((u: any) => {
        // API returns `screen_name` (e.g. "canada_spends") and `userName` (e.g. "canada_spends")
        // We should check both, and remove @ if present just in case.
        const handles = [u.screen_name, u.userName, u.screenName].filter(Boolean);
        return handles.some(h => h.toLowerCase() === targetHandle.toLowerCase().replace(/^@/, ""));
      });
      if (found) return true;
    }
  } catch (err) {
    console.error(`Failed to check follows for ${followerHandle} -> ${targetHandle}`, err);
  }

  return false;
}

export const TwitterApi = {
  getUserInfo,
  checkFollows,
};
