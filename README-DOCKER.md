# Running Nitter Locally with Docker

This directory includes a Docker Compose setup to run your own Nitter instance + Redis.

## Quick Start

1. **Start Nitter + Redis:**
   ```bash
   docker compose up -d
   ```

2. **Check logs to confirm it's running:**
   ```bash
   docker compose logs -f nitter
   ```
   Wait for: `[info] Serving on http://0.0.0.0:8080`

3. **Test in your browser:**
   Open `http://localhost:8080/search?f=tweets&q=elon%20musk`

4. **Point your scraper at it:**
   Create `.env` from `.env.example` and set:
   ```
   NITTER_INSTANCES=http://localhost:8080
   ```

5. **Run your scraper:**
   ```bash
   npm run dev -- --q "build canada" --limit 5
   ```

## Managing the Docker Containers

- **Stop:** `docker compose down`
- **Stop and remove data:** `docker compose down -v` (deletes Redis cache)
- **Restart:** `docker compose restart`
- **View logs:** `docker compose logs -f nitter` or `docker compose logs -f nitter-redis`

## Configuration

Edit `nitter.conf` to customize:
- Cache durations (`listMinutes`, `rssMinutes`)
- Token count (`tokenCount`) — more tokens = better rate limits
- Security: change `hmacKey` if you expose this publicly
- Proxy settings if you need to route through a proxy

After changing config:
```bash
docker compose restart nitter
```

## Notes

- **Redis persistence:** The Redis data is stored in a Docker volume (`nitter-redis-data`), so your cache survives restarts.
- **ARM64 (Apple Silicon):** If you're on an M1/M2/M3 Mac and encounter issues, change the image in `docker-compose.yml` to:
  ```yaml
  image: zedeus/nitter:latest-arm64
  ```
- **Public deployment:** If deploying to a VPS, bind to a specific IP or use a reverse proxy (nginx/Caddy) with HTTPS.

## Troubleshooting

**"Connection refused" when scraping:**
- Make sure containers are running: `docker compose ps`
- Check Nitter logs: `docker compose logs nitter`

**Empty search results:**
- Nitter can break when X/Twitter changes upstream endpoints
- Check logs for errors
- Try a different query in your browser first to confirm Nitter is working

**Redis connection errors:**
- Ensure `redisHost = "nitter-redis"` in `nitter.conf` matches the service name in `docker-compose.yml`
