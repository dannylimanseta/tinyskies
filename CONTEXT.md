# Tiny Skies Context

- Monorepo with `client`, `server`, and `shared` npm workspaces.
- The server is Express + Socket.io and keeps world metadata, save feed entries, dashboard events, and lantern counts in process memory via `server/src/memoryStore.ts`.
- There is no database or Prisma path. Server restarts reset worlds and dashboard/feed history; startup seeds 20 system worlds.
- Multiplayer room state stays in `RoomManager`/`Room`; worlds are matched to rooms by slug.
- Do not store tests in the repo and do not run Black.
