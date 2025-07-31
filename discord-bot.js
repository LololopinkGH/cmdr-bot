// discord-bot.js
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

// Create client with additional options for better connectivity
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    // Add WebSocket options for better connectivity
    ws: {
        large_threshold: 50,
        compress: false,
        properties: {
            os: process.platform,
            browser: 'discord.js',
            device: 'discord.js'
        }
    },
    // Reduce timeout issues
    restTimeOffset: 0,
    restWsBridgeTimeout: 5000,
    restRequestTimeout: 60000,
    // Disable some features that might cause issues
    failIfNotExists: false,
    allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true
    }
});

// Use the public URL for Render deployment
const SERVER_URL = process.env.SERVER_URL || 'https://cmdr-bot.onrender.com';
console.log('Using SERVER_URL:', SERVER_URL);

// Debug: Log all environment variables
console.log('Environment check:');
console.log('- DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? '✅ Set' : '❌ Missing');
console.log('- GUILD_ID:', process.env.GUILD_ID ? '✅ Set' : '❌ Missing');
console.log('- SERVER_URL:', SERVER_URL);
console.log('- PORT:', process.env.PORT || 'Using default');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'Not set');

// Check required environment variables
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in environment variables');
    process.exit(1);
}

if (!process.env.GUILD_ID) {
    console.error('❌ GUILD_ID is not set in environment variables');
    process.exit(1);
}

// User ID mapping (Discord ID -> Roblox UserId)  
const userMapping = {
    '1252626721522454574': 1346667455,
};

// Server ID mapping (for multi-server support)
const serverMapping = {
    '1395135448522821632': 'main_server'
};

const commands = [
    new SlashCommandBuilder()
        .setName('roblox')
        .setDescription('Execute a Roblox command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command to execute')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('args')
                .setDescription('Command arguments (space-separated)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('server')
                .setDescription('Target server')
                .setRequired(false)),
];

async function deployCommands() {
    const rest = new REST({ timeout: 60000 }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('🔄 Deploying slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands deployed successfully!');
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

async function executeRobloxCommand(discordUserId, command, args, serverId) {
    const robloxUserId = userMapping[discordUserId];
    
    if (!robloxUserId) {
        throw new Error('Discord account not linked to Roblox account');
    }
    
    const payload = {
        discordUserId,
        robloxUserId,
        command,
        args: args ? args.split(' ') : [],
        serverId
    };
    
    console.log('📤 Sending command to server:', payload);
    
    try {
        const response = await axios.post(`${SERVER_URL}/api/command`, payload, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Discord-Roblox-Bridge/1.0'
            }
        });
        console.log('✅ Server response:', response.data);
        return response.data.commandId;
    } catch (error) {
        console.error('❌ Error sending command:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw new Error(`Failed to send command: ${error.message}`);
    }
}

async function getCommandResult(commandId, maxWait = 10000) {
    const startTime = Date.now();
    console.log(`⏳ Waiting for result of command ${commandId}...`);
    
    while (Date.now() - startTime < maxWait) {
        try {
            const response = await axios.get(`${SERVER_URL}/api/result/${commandId}`, {
                timeout: 5000
            });
            console.log('📥 Got result:', response.data);
            return response.data;
        } catch (error) {
            if (error.response?.status !== 404) {
                console.error('❌ Error getting result:', error.message);
                throw error;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Command execution timeout');
}

// Enhanced event listeners
client.on('ready', async () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🔗 Connected to ${client.guilds.cache.size} guild(s)`);
    
    if (client.guilds.cache.size > 0) {
        console.log(`🏠 Bot is in guilds:`, client.guilds.cache.map(g => `${g.name} (${g.id})`).join(', '));
    } else {
        console.log('⚠️ Bot is not in any guilds! Make sure it\'s properly invited.');
    }
    
    await deployCommands();
});

client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
    console.error('Error stack:', error.stack);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord client warning:', warning);
});

client.on('disconnect', (event) => {
    console.log('🔌 Disconnected from Discord. Event:', event);
});

client.on('reconnecting', () => {
    console.log('🔄 Reconnecting to Discord...');
});

client.on('resume', (replayed) => {
    console.log(`▶️ Resumed Discord connection. Replayed ${replayed} events.`);
});

client.on('shardError', error => {
    console.error('❌ WebSocket connection error:', error);
});

client.on('shardReconnecting', () => {
    console.log('🔄 WebSocket is reconnecting...');
});

client.on('shardReady', () => {
    console.log('✅ WebSocket connection ready');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'roblox') {
        console.log(`💬 Command received from ${interaction.user.tag}: ${interaction.options.getString('command')}`);
        await interaction.deferReply();
        
        const command = interaction.options.getString('command');
        const args = interaction.options.getString('args');
        const server = interaction.options.getString('server') || serverMapping[interaction.channelId] || 'main_server';
        
        try {
            const commandId = await executeRobloxCommand(
                interaction.user.id,
                command,
                args,
                server
            );
            
            console.log(`✅ Command sent successfully, ID: ${commandId}`);
            
            const embed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('🔄 Command Sent')
                .setDescription(`Command: \`${command}${args ? ' ' + args : ''}\``)
                .addFields(
                    { name: 'Command ID', value: commandId, inline: true },
                    { name: 'Server', value: server, inline: true }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            // Wait for result
            try {
                const result = await getCommandResult(commandId);
                
                const resultEmbed = new EmbedBuilder()
                    .setTitle(result.success ? '✅ Command Executed' : '❌ Command Failed')
                    .setColor(result.success ? '#00ff00' : '#ff0000')
                    .setDescription(`Command: \`${command}${args ? ' ' + args : ''}\``)
                    .addFields(
                        { name: 'Result', value: result.result || result.error || 'No output', inline: false }
                    )
                    .setTimestamp();
                
                await interaction.followUp({ embeds: [resultEmbed] });
            } catch (resultError) {
                console.error('❌ Result error:', resultError.message);
                const timeoutEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⏰ Command Timeout')
                    .setDescription('Command was sent but no response received within 10 seconds')
                    .setTimestamp();
                
                await interaction.followUp({ embeds: [timeoutEmbed] });
            }
            
        } catch (error) {
            console.error('❌ Command error:', error.message);
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Error')
                .setDescription(error.message)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
});

// Simplified connection function with better error handling
async function connectWithRetry(maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Attempting to connect to Discord (attempt ${attempt}/${maxRetries})...`);
            
            // Create a timeout promise
            const timeoutMs = 60000; // 60 seconds
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Discord login timeout after ${timeoutMs/1000} seconds`));
                }, timeoutMs);
            });
            
            // Attempt login with timeout
            const loginPromise = client.login(process.env.DISCORD_TOKEN);
            
            await Promise.race([loginPromise, timeoutPromise]);
            
            console.log('✅ Login call completed, waiting for ready event...');
            
            // Wait for ready event with timeout
            await new Promise((resolve, reject) => {
                const readyTimeout = setTimeout(() => {
                    reject(new Error('Ready event timeout after 30 seconds'));
                }, 30000);
                
                if (client.isReady()) {
                    clearTimeout(readyTimeout);
                    resolve();
                    return;
                }
                
                const onReady = () => {
                    clearTimeout(readyTimeout);
                    client.removeListener('error', onError);
                    resolve();
                };
                
                const onError = (error) => {
                    clearTimeout(readyTimeout);
                    client.removeListener('ready', onReady);
                    reject(error);
                };
                
                client.once('ready', onReady);
                client.once('error', onError);
            });
            
            console.log('🎉 Bot is fully connected and ready!');
            return; // Success!
            
        } catch (error) {
            lastError = error;
            console.error(`❌ Connection attempt ${attempt} failed:`, error.message);
            
            if (error.code) {
                console.error('Discord Error Code:', error.code);
                
                // Handle specific error codes that shouldn't retry
                if (error.code === 'TOKEN_INVALID') {
                    console.error('❌ Invalid Discord token. Please check your DISCORD_TOKEN.');
                    process.exit(1);
                }
                
                if (error.code === 'DISALLOWED_INTENTS') {
                    console.error('❌ Bot missing required intents. Check Discord Developer Portal.');
                    process.exit(1);
                }
            }
            
            // Clean up the client for next attempt
            try {
                if (client.ws && client.ws.connection) {
                    client.destroy();
                }
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError.message);
            }
            
            if (attempt < maxRetries) {
                const waitTime = Math.min(10000 * attempt, 30000); // Progressive backoff
                console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    console.error('❌ All connection attempts failed. Last error:', lastError?.message);
    process.exit(1);
}

// Handle graceful shutdown
const shutdown = (signal) => {
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);
    
    try {
        if (client.isReady()) {
            client.destroy();
        }
    } catch (error) {
        console.error('Error during shutdown:', error.message);
    }
    
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
});

// Start the bot
console.log('🚀 Starting Discord bot connection...');
connectWithRetry().catch(error => {
    console.error('❌ Fatal startup error:', error);
    process.exit(1);
});