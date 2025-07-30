// start.js
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Discord-Roblox Bridge...\n');

// Start the server
console.log('📡 Starting bridge server...');
const server = spawn('node', ['server.js'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname
});

// Start the Discord bot
console.log('🤖 Starting Discord bot...');
const bot = spawn('node', ['discord-bot.js'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname
});

// Handle server output
server.stdout.on('data', (data) => {
    console.log(`[SERVER] ${data.toString().trim()}`);
});

server.stderr.on('data', (data) => {
    console.error(`[SERVER ERROR] ${data.toString().trim()}`);
});

// Handle bot output
bot.stdout.on('data', (data) => {
    console.log(`[BOT] ${data.toString().trim()}`);
});

bot.stderr.on('data', (data) => {
    console.error(`[BOT ERROR] ${data.toString().trim()}`);
});

// Handle process exits
server.on('close', (code) => {
    console.log(`\n❌ Server process exited with code ${code}`);
    if (code !== 0) {
        console.log('Stopping bot due to server failure...');
        bot.kill();
    }
});

bot.on('close', (code) => {
    console.log(`\n❌ Bot process exited with code ${code}`);
    if (code !== 0) {
        console.log('Stopping server due to bot failure...');
        server.kill();
    }
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.kill('SIGTERM');
    bot.kill('SIGTERM');
    
    setTimeout(() => {
        console.log('Force killing processes...');
        server.kill('SIGKILL');
        bot.kill('SIGKILL');
        process.exit(0);
    }, 5000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    server.kill();
    bot.kill();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.kill();
    bot.kill();
    process.exit(1);
});

console.log('\n✅ Both services started!');
console.log('Press Ctrl+C to stop both services\n');