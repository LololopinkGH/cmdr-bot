// server.js
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage for commands (use Redis/Database in production)
const commandQueue = new Map();
const commandResults = new Map();

// Add a status page for the root URL
app.get('/', (req, res) => {
    const stats = {
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        queued_commands: commandQueue.size,
        stored_results: commandResults.size,
        endpoints: {
            'POST /api/command': 'Submit new command',
            'GET /api/commands/:serverId': 'Get pending commands for server',
            'POST /api/result': 'Submit command result',
            'GET /api/result/:commandId': 'Get command result'
        }
    };
    
    res.json(stats);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// Discord bot will POST commands here
app.post('/api/command', (req, res) => {
    console.log('[API] Received command:', req.body);
    const { discordUserId, robloxUserId, command, args, serverId } = req.body;
    
    if (!command || !robloxUserId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const commandId = uuidv4();
    const commandData = {
        id: commandId,
        discordUserId,
        robloxUserId,
        command,
        args: args || [],
        serverId,
        timestamp: Date.now(),
        executed: false
    };
    
    commandQueue.set(commandId, commandData);
    
    // Auto-cleanup after 5 minutes
    setTimeout(() => {
        commandQueue.delete(commandId);
        commandResults.delete(commandId);
    }, 300000);
    
    res.json({ commandId, message: 'Command queued successfully' });
});

// Roblox will GET pending commands from here
app.get('/api/commands/:serverId', (req, res) => {
    const { serverId } = req.params;
    const pendingCommands = [];
    
    for (const [id, cmd] of commandQueue.entries()) {
        if (!cmd.executed && (!serverId || cmd.serverId === serverId)) {
            pendingCommands.push(cmd);
            cmd.executed = true; // Mark as sent to Roblox
        }
    }
    
    res.json({ commands: pendingCommands });
});

// Roblox will POST command results here
app.post('/api/result', (req, res) => {
    const { commandId, success, result, error } = req.body;
    
    commandResults.set(commandId, {
        success,
        result,
        error,
        timestamp: Date.now()
    });
    
    res.json({ message: 'Result received' });
});

// Discord bot will GET command results from here
app.get('/api/result/:commandId', (req, res) => {
    console.log('[API] Result requested for:', req.params.commandId);
    const { commandId } = req.params;
    const result = commandResults.get(commandId);
    
    if (!result) {
        return res.status(404).json({ error: 'Result not found' });
    }
    
    res.json(result);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bridge server running on port ${PORT}`);
});