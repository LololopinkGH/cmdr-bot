// start.js - Alternative approach with staggered startup
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Discord-Roblox Bridge...\n');

// Start the server first and wait for it to be ready
console.log('📡 Starting bridge server...');
const server = spawn('node', ['server.js'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
    env: { ...process.env }
});

let serverReady = false;
let botProcess = null;

// Handle server output
server.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log(`[SERVER] ${output}`);
    
    // Check if server is ready
    if (output.includes('Bridge server running on port')) {
        serverReady = true;
        console.log('✅ Server is ready, starting Discord bot in 3 seconds...');
        
        // Wait a bit before starting the bot to ensure server is fully ready
        setTimeout(() => {
            startBot();
        }, 3000);
    }
});

server.stderr.on('data', (data) => {
    console.error(`[SERVER ERROR] ${data.toString().trim()}`);
});

function startBot() {
    if (botProcess) {
        console.log('Bot already started, skipping...');
        return;
    }
    
    console.log('🤖 Starting Discord bot...');
    botProcess = spawn('node', ['discord-bot.js'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        cwd: __dirname,
        env: { 
            ...process.env,
            // Add some environment variables that might help with connectivity
            NODE_OPTIONS: '--max-old-space-size=512',
            UV_THREADPOOL_SIZE: '4'
        }
    });

    // Handle bot output
    botProcess.stdout.on('data', (data) => {
        console.log(`[BOT] ${data.toString().trim()}`);
    });

    botProcess.stderr.on('data', (data) => {
        console.error(`[BOT ERROR] ${data.toString().trim()}`);
    });

    // Handle bot process exit
    botProcess.on('close', (code) => {
        console.log(`\n❌ Bot process exited with code ${code}`);
        if (code !== 0 && serverReady) {
            console.log('Bot failed, attempting restart in 10 seconds...');
            botProcess = null;
            setTimeout(() => {
                startBot();
            }, 10000);
        }
    });
    
    botProcess.on('error', (error) => {
        console.error('❌ Bot process error:', error.message);
        botProcess = null;
    });
}

// Handle server process exit
server.on('close', (code) => {
    console.log(`\n❌ Server process exited with code ${code}`);
    if (botProcess) {
        console.log('Stopping bot due to server failure...');
        botProcess.kill();
    }
});

server.on('error', (error) => {
    console.error('❌ Server process error:', error.message);
});

// Handle Ctrl+C gracefully
const shutdown = (signal) => {
    console.log(`\n🛑 Shutting down gracefully... (${signal})`);
    
    if (botProcess) {
        console.log('Stopping bot...');
        botProcess.kill('SIGTERM');
    }
    
    console.log('Stopping server...');
    server.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
        console.log('Force killing processes...');
        if (botProcess) botProcess.kill('SIGKILL');
        server.kill('SIGKILL');
        process.exit(0);
    }, 5000);
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

console.log('\n✅ Starting services...');
console.log('Press Ctrl+C to stop both services\n');

// Set a timeout to start the bot anyway if server doesn't signal ready
setTimeout(() => {
    if (!serverReady && !botProcess) {
        console.log('⚠️ Server ready signal not detected, starting bot anyway...');
        startBot();
    }
}, 15000);