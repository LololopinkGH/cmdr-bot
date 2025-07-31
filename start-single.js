// start-single.js - Single process version for Render
import 'dotenv/config';

console.log('🚀 Starting Discord-Roblox Bridge (Single Process)...\n');

// Import and start the server
import('./server.js').then(() => {
    console.log('✅ Server module loaded');
    
    // Wait a bit then start the Discord bot
    setTimeout(async () => {
        console.log('🤖 Starting Discord bot...');
        try {
            await import('./discord-bot.js');
            console.log('✅ Discord bot module loaded');
        } catch (error) {
            console.error('❌ Failed to load Discord bot:', error);
        }
    }, 3000);
}).catch(error => {
    console.error('❌ Failed to load server:', error);
    process.exit(1);
});

// Handle graceful shutdown
const shutdown = (signal) => {
    console.log(`\n🛑 Shutting down gracefully... (${signal})`);
    console.log(`🔍 Shutdown reason: Signal ${signal} received at ${new Date().toISOString()}`);
    console.log(`⏱️ Process uptime: ${Math.floor(process.uptime())} seconds`);
    
    // Give some time for cleanup then exit
    setTimeout(() => {
        console.log('👋 Goodbye!');
        process.exit(0);
    }, 2000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
});

console.log('✅ Single process bridge started');
console.log('💡 This version runs everything in one process for better Render compatibility');