# AI BuildCon 2026 — Lead Capture App

Full-stack landing page that captures booth partnership enquiries into a SQLite database and optionally sends a Slack notification for every submission.

**Zero npm dependencies.** Uses only Node.js built-ins + Python's built-in `sqlite3`.

---

## Quick Start

```bash
# 1. Make sure you have Node.js ≥16 and Python 3 installed
node --version   # v16+
python3 --version

# 2. Run the server
node server.js
```

Open **http://localhost:3000** — the landing page is live.

---

## Environment Variables

| Variable        | Default           | Description                          |
|----------------|-------------------|--------------------------------------|
| `PORT`         | `3000`            | HTTP port                            |
| `ADMIN_KEY`    | `aibuildcon2026`  | Password for /admin and API access   |
| `SLACK_WEBHOOK`| *(empty)*         | Slack Incoming Webhook URL           |
| `DB_PATH`      | `./data/leads.db` | Path to SQLite database file         |

Set them before running:

```bash
# Linux / macOS
export PORT=3000
export ADMIN_KEY=your-secret-key
export SLACK_WEBHOOK=https://hooks.slack.com/services/XXX/YYY/ZZZ
node server.js

# Or inline
PORT=8080 ADMIN_KEY=mysecret SLACK_WEBHOOK=https://hooks.slack.com/... node server.js
```

---

## Setting Up Slack Notifications

1. Go to **https://api.slack.com/apps** → Create New App → From Scratch
2. Select **Incoming Webhooks** → Activate
3. Click **Add New Webhook to Workspace** → Pick a channel (e.g. `#booth-leads`)
4. Copy the Webhook URL → set as `SLACK_WEBHOOK` env var

Every form submission will post a formatted message to your Slack channel:

```
🚀 New Booth Enquiry — AI BuildCon 2026
Name     Priya Sharma
Email    priya@startup.io
Company  Startup.io
Role     VP of Product
Message  We're an AI-first SaaS, very interested in a booth
Source   `cta`  ·  Mon, 19 May 2026 12:34:56 GMT
```

---

## Admin Panel

View all leads at:
```
http://localhost:3000/admin?key=aibuildcon2026
```

Features:
- **Total / Today / Sources** stats at the top
- Full leads table sorted by most recent
- **Export CSV** button to download all leads
- **View JSON** link for API access
- Link to the live landing page

---

## API Reference

### `POST /api/leads`
Submit a lead. Returns `{ ok: true }` on success.

**Request body:**
```json
{
  "name":      "Priya Sharma",
  "email":     "priya@company.com",
  "company":   "Company Name",
  "role":      "VP of Product",
  "message":   "Optional message",
  "source":    "cta",
  "page_url":  "http://...",
  "referrer":  "https://..."
}
```

**Response:**
```json
{ "ok": true, "message": "Got it! We'll be in touch within 48 hours." }
```

---

### `GET /api/leads?key=ADMIN_KEY`
Returns all leads as a JSON array.

---

### `GET /api/leads/export?key=ADMIN_KEY`
Downloads all leads as a CSV file.

---

### `GET /admin?key=ADMIN_KEY`
HTML dashboard showing all leads.

---

### `GET /health`
Health check endpoint. Returns `{ ok: true, leads: N, uptime: N }`.

---

## CTA Source Tracking

Each CTA button on the page passes a `source` tag so you know which button drove the submission:

| Source      | Where                              |
|-------------|-----------------------------------|
| `nav`       | "Get in touch" button in nav bar   |
| `hero`      | Primary hero CTA button            |
| `booth`     | "Reserve a booth" in booth preview |
| `scarcity`  | "Check availability" scarcity bar  |
| `cta`       | Bottom CTA section button          |

---

## Project Structure

```
aibuildcon-app/
├── server.js          ← Node.js server (zero dependencies)
├── package.json
├── README.md
├── data/
│   └── leads.db       ← SQLite database (auto-created)
└── public/
    └── index.html     ← Landing page with modal + form
```

---

## Deployment

### Railway / Render / Fly.io
```bash
# Set these environment variables in the dashboard:
PORT=8080
ADMIN_KEY=your-strong-secret
SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

### PM2 (VPS)
```bash
npm install -g pm2
pm2 start server.js --name aibuildcon \
  --env PORT=3000 \
  --env ADMIN_KEY=yourkey \
  --env SLACK_WEBHOOK=https://hooks.slack.com/...
pm2 save
pm2 startup
```

### Docker
```dockerfile
FROM node:20-alpine
RUN apk add --no-cache python3
WORKDIR /app
COPY . .
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## Database Backup

The SQLite database is a single file at `./data/leads.db`. Back it up with:

```bash
# Copy the file
cp data/leads.db data/leads_backup_$(date +%Y%m%d).db

# Or export to CSV via the API
curl "http://localhost:3000/api/leads/export?key=aibuildcon2026" -o leads.csv
```
