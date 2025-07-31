// discord-bot.js - ES Module version for Render
import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import 'dotenv/config';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Use Render URL instead of localhost
const SERVER_URL = process.env.SERVER_URL || 'https://cmdr-bot.onrender.com';
console.log('Using SERVER_URL:', SERVER_URL);

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
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('Deploying slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('Slash commands deployed successfully!');
    } catch (error) {
        console.error('Error deploying commands:', error);
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
    
    console.log('Sending command to server:', payload);
    console.log('POST URL:', `${SERVER_URL}/api/command`);
    
    try {
        const response = await axios.post(`${SERVER_URL}/api/command`, payload, {
            timeout: 10000 // Add timeout for Render
        });
        console.log('Server response:', response.data);
        return response.data.commandId;
    } catch (error) {
        console.error('Error sending command:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw new Error(`Failed to send command: ${error.message}`);
    }
}

async function getCommandResult(commandId, maxWait = 10000) {
    const startTime = Date.now();
    console.log(`Waiting for result of command ${commandId}...`);
    
    while (Date.now() - startTime < maxWait) {
        try {
            console.log(`Checking result for ${commandId}...`);
            const response = await axios.get(`${SERVER_URL}/api/result/${commandId}`, {
                timeout: 5000
            });
            console.log('Got result:', response.data);
            return response.data;
        } catch (error) {
            if (error.response?.status !== 404) {
                console.error('Error getting result:', error.message);
                throw error;
            }
            // 404 means result not ready yet, continue waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Command execution timeout');
}

client.on('ready', async () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    await deployCommands();
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'roblox') {
        console.log(`Command received from ${interaction.user.tag}: ${interaction.options.getString('command')}`);
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
            
            console.log(`Command sent successfully, ID: ${commandId}`);
            
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
                console.error('Result error:', resultError.message);
                const timeoutEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⏰ Command Timeout')
                    .setDescription('Command was sent but no response received within 10 seconds')
                    .setTimestamp();
                
                await interaction.followUp({ embeds: [timeoutEmbed] });
            }
            
        } catch (error) {
            console.error('Command error:', error.message);
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Error')
                .setDescription(error.message)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
});

// Add retry logic for Render
async function connectWithRetry(maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔄 Attempting to connect to Discord (attempt ${i + 1}/${maxRetries})...`);
            
            await client.login(process.env.DISCORD_TOKEN);
            console.log('✅ Connected to Discord successfully!');
            return;
            
        } catch (error) {
            console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
            
            if (error.code === 'TOKEN_INVALID') {
                console.error('❌ Invalid Discord token!');
                process.exit(1);
            }
            
            if (i === maxRetries - 1) {
                console.error('❌ Max retries reached. Exiting...');
                process.exit(1);
            }
            
            const waitTime = 5000 * (i + 1); // Progressive delay
            console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Start connection with retry
connectWithRetry();