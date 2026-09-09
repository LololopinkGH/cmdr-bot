// server.js - Render web API for the Discord <-> Roblox command bridge
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({
    limit: '64kb',
    verify: (req, _res, buffer) => {
        req.rawBody = buffer.toString('utf8');
    }
}));

const commandQueue = new Map();
const commandResults = new Map();
const usedNonces = new Map();

const COMMAND_TTL_MS = 5 * 60 * 1000;
const RESULT_TTL_MS = 5 * 60 * 1000;
const SIGNATURE_WINDOW_SECONDS = 90;
const COMMAND_API_SECRET = (process.env.COMMAND_API_SECRET || '').trim();
const GROUP_ROSTER_CACHE_TTL_MS = 10 * 1000;
const groupRosterCache = new Map();

async function fetchUsersForRole(groupId, roleSetId, rank) {
    const users = [];
    let cursor = null;

    do {
        const response = await axios.get(
            `https://groups.roblox.com/v1/groups/${groupId}/roles/${roleSetId}/users`,
            {
                timeout: 8000,
                params: {
                    limit: 100,
                    sortOrder: 'Asc',
                    ...(cursor ? { cursor } : {})
                }
            }
        );

        const page = response.data || {};
        for (const item of page.data || []) {
            const user = item.user || item;
            const userId = Number(user.userId ?? user.id);
            if (!Number.isSafeInteger(userId) || userId <= 0) continue;

            users.push({
                userId,
                username: user.username || user.name || `UserId: ${userId}`,
                displayName: user.displayName || user.display_name || user.username || user.name || '',
                rank
            });
        }

        cursor = page.nextPageCursor || null;
    } while (cursor);

    return users;
}

async function getGroupRankRoster(groupId, requestedRanks) {
    const normalizedRanks = [...new Set(requestedRanks)]
        .filter(rank => Number.isInteger(rank) && rank >= 0 && rank <= 255)
        .sort((a, b) => a - b);

    const cacheKey = `${groupId}:${normalizedRanks.join(',')}`;
    const cached = groupRosterCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < GROUP_ROSTER_CACHE_TTL_MS) {
        return cached.payload;
    }

    const rolesResponse = await axios.get(
        `https://groups.roblox.com/v1/groups/${groupId}/roles`,
        { timeout: 8000 }
    );

    const roleSets = rolesResponse.data?.roles || rolesResponse.data?.data || [];
    const roleByRank = new Map(
        roleSets
            .map(role => [Number(role.rank), role])
            .filter(([rank, role]) => Number.isInteger(rank) && role && role.id)
    );

    const roles = {};
    const errors = [];

    await Promise.all(normalizedRanks.map(async rank => {
        const role = roleByRank.get(rank);
        if (!role) {
            roles[String(rank)] = [];
            errors.push(`No Roblox group role exists for rank ${rank}`);
            return;
        }

        try {
            roles[String(rank)] = await fetchUsersForRole(groupId, role.id, rank);
        } catch (error) {
            roles[String(rank)] = [];
            errors.push(
                `Rank ${rank} fetch failed: ${error.response?.status || error.code || error.message}`
            );
        }
    }));

    const payload = {
        groupId,
        requestedRanks: normalizedRanks,
        roles,
        complete: errors.length === 0,
        errors,
        fetchedAt: new Date().toISOString()
    };

    if (payload.complete) {
        groupRosterCache.set(cacheKey, { fetchedAt: Date.now(), payload });
    }

    return payload;
}

function isLoopback(req) {
    const ip = req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function safeEqualHex(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;

    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyDiscordBridgeRequest(req, res, next) {
    // The Discord bot runs in this same Render process and talks to localhost,
    // so no shared secret is required for the normal single-service setup.
    if (isLoopback(req)) {
        return next();
    }

    // If a secret is configured, signed external bridge requests are also accepted.
    if (!COMMAND_API_SECRET) {
        return res.status(401).json({ error: 'Bridge endpoint is local-only' });
    }

    const timestamp = req.get('X-Area-Timestamp');
    const nonce = req.get('X-Area-Nonce');
    const signature = req.get('X-Area-Signature');

    if (!timestamp || !nonce || !signature) {
        return res.status(401).json({ error: 'Missing bridge signature' });
    }

    const timestampNumber = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber) > SIGNATURE_WINDOW_SECONDS) {
        return res.status(401).json({ error: 'Expired bridge signature' });
    }

    if (usedNonces.has(nonce)) {
        return res.status(401).json({ error: 'Replay rejected' });
    }

    const body = req.rawBody || '';
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const path = req.originalUrl.split('?')[0];
    const canonical = [req.method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
    const expected = crypto.createHmac('sha256', COMMAND_API_SECRET).update(canonical).digest('hex');

    if (!safeEqualHex(signature, expected)) {
        return res.status(401).json({ error: 'Invalid bridge signature' });
    }

    usedNonces.set(nonce, Date.now());
    setTimeout(() => usedNonces.delete(nonce), SIGNATURE_WINDOW_SECONDS * 2000).unref?.();
    next();
}

app.get('/', (_req, res) => {
    res.json({
        status: 'online',
        service: 'Discord-Roblox command bridge',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        queuedCommands: commandQueue.size,
        storedResults: commandResults.size,
        discordBot: 'same-process'
    });
});

app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: Math.floor(process.uptime())
    });
});

// Public group roster proxy used by Roblox listranks to include offline group members.
app.get('/api/group-ranks/:groupId', async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
        return res.status(400).json({ error: 'Invalid groupId' });
    }

    const requestedRanks = String(req.query.ranks || '')
        .split(',')
        .map(value => Number(value.trim()))
        .filter(Number.isInteger)
        .slice(0, 50);

    if (requestedRanks.length === 0) {
        return res.status(400).json({ error: 'At least one rank must be requested' });
    }

    try {
        const payload = await getGroupRankRoster(groupId, requestedRanks);
        res.json(payload);
    } catch (error) {
        console.error('[GROUP ROSTER] Failed:', error.message);
        res.status(502).json({
            error: 'Unable to fetch Roblox group roster',
            detail: error.response?.status || error.code || error.message
        });
    }
});

// Discord bot -> bridge. Localhost-only unless COMMAND_API_SECRET is configured.
app.post('/api/command', verifyDiscordBridgeRequest, (req, res) => {
    const {
        discordUserId,
        robloxUserId,
        command,
        args,
        serverId,
        discordTag,
        permission,
        guildId
    } = req.body || {};

    if (!command || !robloxUserId || !serverId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const commandId = uuidv4();
    const commandData = {
        id: commandId,
        discordUserId,
        robloxUserId,
        command: String(command),
        args: Array.isArray(args) ? args : [],
        serverId: String(serverId),
        discordTag,
        permission,
        guildId,
        timestamp: Date.now(),
        executed: false
    };

    commandQueue.set(commandId, commandData);

    setTimeout(() => {
        commandQueue.delete(commandId);
    }, COMMAND_TTL_MS).unref?.();

    res.json({ commandId, message: 'Command queued successfully' });
});

// Roblox server -> bridge. Kept compatible with the existing Roblox polling script.
app.get('/api/commands/:serverId', (req, res) => {
    const serverId = String(req.params.serverId || '');
    const pendingCommands = [];

    for (const cmd of commandQueue.values()) {
        if (!cmd.executed && cmd.serverId === serverId) {
            pendingCommands.push(cmd);
            cmd.executed = true;
        }
    }

    res.json({ commands: pendingCommands });
});

// Roblox server -> bridge result submission.
app.post('/api/result', (req, res) => {
    const { commandId, success, result, error } = req.body || {};

    if (!commandId) {
        return res.status(400).json({ error: 'Missing commandId' });
    }

    commandResults.set(String(commandId), {
        success: Boolean(success),
        result,
        error,
        timestamp: Date.now()
    });

    setTimeout(() => {
        commandResults.delete(String(commandId));
    }, RESULT_TTL_MS).unref?.();

    res.json({ message: 'Result received' });
});

// Discord bot -> bridge. Localhost-only unless COMMAND_API_SECRET is configured.
app.get('/api/result/:commandId', verifyDiscordBridgeRequest, (req, res) => {
    const commandId = String(req.params.commandId || '');
    const result = commandResults.get(commandId);

    if (!result) {
        return res.status(404).json({ error: 'Result not found' });
    }

    res.json(result);
});

export function startServer() {
    const port = Number(process.env.PORT) || 10000;

    return new Promise((resolve, reject) => {
        const server = app.listen(port, '0.0.0.0', () => {
            console.log(`✅ Bridge API listening on port ${port}`);
            console.log(`❤️ Health check: /health`);
            resolve(server);
        });

        server.on('error', reject);
    });
}

export { app };
