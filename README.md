# GlobeFly

Multiplayer Three.js game where players fly planes around customizable globes.

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL running locally (or via Docker)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

```bash
# Start Postgres (if using Docker)
docker run -d --name globefly-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=globefly -p 5432:5432 postgres:16

# Generate Prisma client and run migrations
cd server
npx prisma generate
npx prisma migrate dev --name init
cd ..
```

### 3. Run both client and server

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

### 4. Play

1. Open the client in your browser
2. Create a world (give it a name and pick a texture)
3. Copy the world code
4. Open another tab, paste the code, and join with a different name
5. Fly around together!

## Controls

| Key | Action |
|-----|--------|
| W / S | Pitch down / up |
| A / D | Turn left / right |
| Shift | Speed up |
| Ctrl | Slow down |

## Deployment

Production URL for the game client: **https://tinyskies.vercel.app** (Vercel assigns `{project-name}.vercel.app` — name the Vercel project **`tinyskies`**, or add **tinyskies.vercel.app** under **Project → Settings → Domains**).

### Client (Vercel)

This repo’s root `vercel.json` builds the client (`npm run build -w client`) and serves `client/dist` with SPA rewrites.

In **Vercel → Project → Settings → Environment Variables** (Production):

| Variable | Value |
|----------|--------|
| `VITE_SERVER_URL` | Your public server URL, e.g. `https://your-app.up.railway.app` (no trailing slash) |

See `client/.env.example`. Redeploy after changing env vars so Vite bakes in `VITE_SERVER_URL`.

### Server (Railway or similar)

Deploy with `server/Dockerfile`. Set:

| Variable | Value |
|----------|--------|
| `DATABASE_URL` | PostgreSQL connection string |
| `CLIENT_URL` | **`https://tinyskies.vercel.app`** — must match the browser origin exactly (scheme + host) for CORS and Socket.io |
| `PORT` | `3001` (or your host’s assigned port) |

Local dev keeps defaults: client `http://localhost:5173`, server `http://localhost:3001`.

## Tech Stack

- **Client**: Vite, TypeScript, Three.js, Socket.io
- **Server**: Node.js, Express, Socket.io, Prisma
- **Database**: PostgreSQL
- **Architecture**: Quaternion-based spherical math for singularity-free globe flight, relay server with client-side prediction and slerp interpolation
