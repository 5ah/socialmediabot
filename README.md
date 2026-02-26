# CanadaSpends Social Media Bot

A powerful social media monitoring tool designed to track the online presence of CanadaSpends, monitor VIP accounts (MPs, Journalists), and analyze engagement on Twitter/X.

> **Note:** This project was built with the assistance of **Antigravity** by Google DeepMind.

## 🚀 Features

*   **Keyword Monitoring:** Automatically tracks mentions of `@canada_spends`, "CanadaSpends", and related keywords across Twitter/X using Nitter instances.
*   **Link Tracking:** Detects tweets sharing links to `canadaspends.ca` (or configured domain).
*   **High Traction Alerts:** Identifies popular replies and engagement on your tweets (e.g., >10 likes or >5 retweets).
*   **VIP Tracker:** Monitors a curated list of VIPs (MPs, Journalists, Influencers) to check if they follow your account.
*   **Discord Integration:** Sends real-time alerts to a Discord channel via Webhook.
*   **Smart Filtering:** Automatically excludes your own tweets from alerts to prevent noise.
*   **Docker Support:** Easily deployable with Docker Compose, including a local Nitter instance for reliable scraping.

## 🛠️ Tech Stack

*   **Node.js & TypeScript:** Core logic and type safety.
*   **Nitter:** Uses public Nitter instances (or a local one) for search and scraping without requiring a Twitter API subscription for basic monitoring.
*   **TwitterAPI.io:** Used for enrichment (follower counts) and VIP relationship checking.
*   **Discord Webhooks:** For notifications.

## 📦 Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/socialmediabot.git
    cd socialmediabot
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Copy `.env.example` to `.env` and fill in the required values:
    ```bash
    cp .env.example .env
    ```

    **Key Variables:**
    *   `DISCORD_WEBHOOK_URL`: Your Discord Webhook URL for alerts.
    *   `TWITTER_API_IO_KEY`: API key from [twitterapi.io](https://twitterapi.io/) (for VIP tracking & enrichment).
    *   `MAIN_ACCOUNT_HANDLE`: The handle to track (e.g., `canada_spends`).
    *   `NITTER_INSTANCES`: Comma-separated list of Nitter instances (e.g., `https://nitter.net,http://localhost:8080`).

## 🏃 Usage

### Run the Monitor Service
Starts the main worker that polls for new tweets and checks VIPs periodically.
```bash
npm run worker
```

### Run VIP Check Manually
Performs a one-time check of your VIP list to see who follows you.
```bash
npm run check-vips
```

### Development Mode
```bash
npm run dev
```

## 🐳 Docker Deployment

1.  **Start Services (Nitter + Redis):**
    ```bash
    docker compose up -d
    ```
    This spins up a local Nitter instance on port 8080, which the bot can use for reliable scraping.

2.  **View Logs:**
    ```bash
    docker compose logs -f
    ```

## 📝 Configuration

*   **VIP List:** Edit `vip_list.json` to add or remove accounts you want to track.
*   **Search Queries:** Modify `src/worker.ts` to adjust the search logic or add new monitoring keywords.

## 📄 License
[MIT](LICENSE)
