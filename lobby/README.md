# Protoverse Theater Lobby

A session discovery service that lets friends find and join active watch parties.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Fly.io Cinema  │────▶│     Convex      │◀────│  Lobby Page     │
│  (WS Server)    │     │  (Real-time DB) │     │  (Static HTML)  │
│                 │     │                 │     │                 │
│  • Registers    │     │  • sessions     │     │  • Lists active │
│  • Heartbeats   │     │  • HTTP routes  │     │  • Click to     │
│  • Ends         │     │  • Cron cleanup │     │    join         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Setup Instructions

### 1. Install Convex

```bash
cd /path/to/protoverse
npm install convex
```

### 2. Initialize Convex Project

```bash
npx convex dev
```

This will:
- Create a Convex account (if needed)
- Create a new project
- Deploy the schema and functions
- Give you a deployment URL

Note the **HTTP Actions URL** from the output (something like `https://your-project.convex.site`).

### 3. Configure Fly.io Apps

Add environment variables to your Fly.io cinema apps:

```bash
# For each cinema app (e.g., protoverse-bigtrouble)
fly secrets set CONVEX_HTTP_URL=https://your-project.convex.site -a protoverse-bigtrouble

# Optional: customize public URLs if different from defaults
fly secrets set FLY_APP_NAME=protoverse-bigtrouble -a protoverse-bigtrouble
fly secrets set WS_PUBLIC_URL=wss://protoverse-bigtrouble.fly.dev:8765 -a protoverse-bigtrouble
fly secrets set FOUNDRY_PUBLIC_URL=wss://protoverse-bigtrouble.fly.dev/ws -a protoverse-bigtrouble
```

Or add to `cinema/fly.template.toml`:

```toml
[env]
  # ... existing env vars ...
  CONVEX_HTTP_URL = "https://your-project.convex.site"
```

### 4. Deploy Lobby Page

**Option A: Netlify (Recommended)**

1. Create a new Netlify site
2. Deploy the `lobby/` directory
3. Set environment variables in Netlify UI:
   - `CONVEX_HTTP_URL` = your Convex HTTP URL
   - `PROTOVERSE_URL` = your main Protoverse URL (e.g., `https://cozytheatership.netlify.app`)

Or use the Netlify CLI:
```bash
cd lobby
netlify deploy --prod --dir .
```

**Option B: Edit lobby/index.html directly**

Update the configuration at the bottom of the file:
```javascript
const CONVEX_HTTP_URL = 'https://your-project.convex.site';
const PROTOVERSE_URL = 'https://cozytheatership.netlify.app';
```

### 5. Test the Setup

1. Start a watch party (create a session from Protoverse)
2. Open the lobby page
3. You should see your session listed
4. Click "Join Party" to open Protoverse with the session pre-filled

## Environment Variables

### Fly.io (ws-server.js)

| Variable | Description | Default |
|----------|-------------|---------|
| `CONVEX_HTTP_URL` | Convex HTTP endpoint | (disabled if not set) |
| `FLY_APP_NAME` | Fly app name for URLs | from `FLY_APP` env |
| `WS_PUBLIC_URL` | Public WebSocket URL | `wss://{FLY_APP_NAME}.fly.dev:8765` |
| `FOUNDRY_PUBLIC_URL` | Public Foundry URL | `wss://{FLY_APP_NAME}.fly.dev/ws` |

### Lobby Page

| Variable | Description | Example |
|----------|-------------|---------|
| `CONVEX_HTTP_URL` | Convex HTTP endpoint | `https://abc123.convex.site` |
| `PROTOVERSE_URL` | Main Protoverse URL | `https://cozytheatership.netlify.app` |

## Convex Dashboard

You can view active sessions and debug issues in the Convex dashboard:

1. Go to https://dashboard.convex.dev
2. Select your project
3. View the `sessions` table
4. See logs for HTTP actions and cron jobs

## Troubleshooting

### Sessions not appearing in lobby

1. Check that `CONVEX_HTTP_URL` is set on your Fly.io app
2. Check Convex dashboard for errors
3. Verify the WS server is logging `[Convex] Registering session`

### Sessions not being cleaned up

The cron job runs every 60 seconds. Sessions are removed after 90 seconds without a heartbeat.

### CORS errors in lobby

The HTTP routes include CORS headers. If you still see errors, check that you're using the correct Convex URL (ending in `.convex.site` for HTTP actions).
