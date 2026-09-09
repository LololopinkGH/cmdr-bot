// start-single.js - Runs the Render API and Discord bot in one web service.
import 'dotenv/config';
import { startServer } from './server.js';

console.log('🚀 Starting Discord-Roblox bridge...');

await startServer();

// The bot talks to the API over localhost when both run in this same Render service.
// SERVER_URL can still override this for development or a split deployment.
if (!process.env.SERVER_URL) {
    process.env.SERVER_URL = `http://127.0.0.1:${Number(process.env.PORT) || 10000}`;
}

await import('./discord-bot.js');

console.log('✅ API and Discord bot started in one Render process');
