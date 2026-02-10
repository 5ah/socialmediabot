import "dotenv/config";
import { getUserInfo, checkFollows } from "../twitterApiIoClient.js";

async function main() {
  const targetUser = "x"; // Test with a known user
  const followerUser = "ElonMusk"; // Test with a known follower of Twitter (maybe?)

  if (!process.env.TWITTER_API_IO_KEY) {
    console.error("Error: TWITTER_API_IO_KEY is not set.");
    process.exit(1);
  }

  console.log(`Fetching info for ${targetUser}...`);
  try {
    const info = await getUserInfo(targetUser);
    console.log("Success! User Info:", info);
  } catch (err) {
    console.error("Failed to fetch user info:", err);
  }

  // Optional: Check follows
  // console.log(`Checking if ${followerUser} follows ${targetUser}...`);
  // const follows = await checkFollows(followerUser, targetUser);
  // console.log(`Follows: ${follows}`);
}

main();
