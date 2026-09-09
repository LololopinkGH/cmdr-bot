# Cmdr Discord-Roblox Bridge

This repository is configured to run the Discord bot and the HTTP command bridge together in **one Render Web Service**.

## Render settings

- Build command: `npm install`
- Start command: `npm start`
- Required environment variable: `DISCORD_TOKEN`
- Optional environment variable: `COMMAND_API_SECRET`
- Do not set `SERVER_URL` on Render unless you intentionally want the bot to use another bridge. By default it talks to the same service over localhost.
- Render supplies `PORT` automatically.

## Health endpoint

`GET /health`

The existing Roblox bridge endpoints remain:

- `GET /api/commands/:serverId`
- `POST /api/result`

Discord-side bridge endpoints are local-only unless `COMMAND_API_SECRET` is configured.
