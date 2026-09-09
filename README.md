# TFRRPG Cmdr Discord Bot

Minimal deployment repository for the Cmdr Discord bot.

## Northflank

Create a Combined Service from this repository using Buildpack.

Runtime command:

```text
npm start
```

No public ports are required.

Set these runtime environment variables in Northflank:

```text
DISCORD_TOKEN=<your Discord bot token>
SERVER_URL=https://cmdr-bot.onrender.com
COMMAND_API_SECRET=<the same API secret used by the Cmdr backend>
```

Do not commit `.env` or `node_modules`.
