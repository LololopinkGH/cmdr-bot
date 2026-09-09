// discord-bot.js - Multi-Server with Per-Server Role Configuration + Supreme Override
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import crypto from 'node:crypto';
import 'dotenv/config';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const SERVER_URL = process.env.SERVER_URL || `http://127.0.0.1:${Number(process.env.PORT) || 10000}`;
const COMMAND_API_SECRET = (process.env.COMMAND_API_SECRET || '').trim();
console.log('Using SERVER_URL:', SERVER_URL);

function signedHeaders(method, path, body = '') {
    const headers = {
        'Content-Type': 'application/json'
    };

    // In the single Render-service setup the bot calls localhost, so signing is
    // optional. If a secret is configured, keep signed requests compatible with
    // split/external deployments.
    if (!COMMAND_API_SECRET) {
        return headers;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
    const signature = crypto.createHmac('sha256', COMMAND_API_SECRET).update(canonical).digest('hex');

    return {
        ...headers,
        'X-Area-Timestamp': timestamp,
        'X-Area-Nonce': nonce,
        'X-Area-Signature': signature
    };
}

// ⚙️ CONFIGURABLE TIMEOUTS
const COMMAND_EXECUTION_TIMEOUT = 30000; // 30 seconds for slow commands
const HTTP_REQUEST_TIMEOUT = 35000;     // Slight buffer over execution timeout
const USER_COMMAND_COOLDOWN_MS = 3000;
const MAX_ACTIVE_COMMANDS = 20;
const recentCommandAt = new Map();
let activeCommands = 0;

const PREFIX = '!';

// 👑 SUPREME USER CONFIGURATION
const SUPREME_USER = {
    discordId: '1252626721522454574',
    robloxUserId: 1346667455,
    permission: 'Owner'
};

// ============================================
// DISCORD SERVER TO ROBLOX GAME MAPPING
// ============================================
const GUILD_TO_GAME_MAPPING = {
    '1300097398776926260': 'forgotten_realms',
    '1368816336003792966': 'black_sigil',
    '1395135448522821632': 'personal_server'
};

// ============================================
// ROLE MAPPINGS PER DISCORD SERVER
// ============================================
const DISCORD_ROLE_MAPPING = {
    // Forgotten Realsm RPG Server (1300097398776926260)
    '1300097398776926260': {
        '1496989316495310928': {
            robloxUserId: 1346667455,
            permission: 'Owner'
        },
        '1497009648186949763': {
            robloxUserId: 325784305,
            permission: 'HeadAdmin'
        },
        '1497008541087568033': {
            robloxUserId: 1199435646,
            permission: 'Admin'
        },
        '1497007674938753275': {
            robloxUserId: 1,
            permission: 'Tester'
        }
    },

    // Black Sigil Server (1368816336003792966)
    '1368816336003792966': {
        '1369871525842391132': {
            robloxUserId: 8420802298,
            permission: 'Owner'
        },
        '1369871690657562704': {
            robloxUserId: 325784305,
            permission: 'HeadAdmin'
        },
        '1382087624851980409': {
            robloxUserId: 1199435646,
            permission: 'Admin'
        },
        '1369871790469414952': {
            robloxUserId: 1,
            permission: 'Tester'
        }
    },

    // Personal Server (1395135448522821632)
    '1395135448522821632': {
        '1400291604769669160': {
            robloxUserId: 1346667455,
            permission: 'Owner'
        },
        '1400291577510756362': {
            robloxUserId: 325784305,
            permission: 'HeadAdmin'
        },
        '1400291552378490942': {
            robloxUserId: 1199435646,
            permission: 'Admin'
        },
        '1400291468588880043': {
            robloxUserId: 1,
            permission: 'Tester'
        }
    },

    // Default fallback (if server not configured)
    default: {
        '1400291604769669160': {
            robloxUserId: 1346667455,
            permission: 'Owner'
        },
        '1400291577510756362': {
            robloxUserId: 325784305,
            permission: 'HeadAdmin'
        },
        '1400291552378490942': {
            robloxUserId: 1199435646,
            permission: 'Admin'
        },
        '1400291468588880043': {
            robloxUserId: 1,
            permission: 'Tester'
        }
    }
};

function getRoleMappingForGuild(guildId) {
    return DISCORD_ROLE_MAPPING[guildId] || DISCORD_ROLE_MAPPING.default;
}

function getGameServerFromGuild(guildId) {
    const gameServerId = GUILD_TO_GAME_MAPPING[guildId];
    if (!gameServerId) {
        console.warn(`⚠️ No game mapping found for guild ${guildId}`);
        return 'unknown_server';
    }
    return gameServerId;
}

async function getUserRoleMapping(member, guildId) {
    try {
        // 👑 SUPREME OVERRIDE: Grant supreme access regardless of roles
        if (member.id === SUPREME_USER.discordId) {
            return {
                robloxUserId: SUPREME_USER.robloxUserId,
                permission: SUPREME_USER.permission,
                isSupreme: true
            };
        }

        const userRoles = member.roles.cache;
        const roleMappings = getRoleMappingForGuild(guildId);

        // Check all roles this user has and find the highest permission
        let highestMapping = null;
        const permissionHierarchy = { 'Owner': 4, 'HeadAdmin': 3, 'Admin': 2, 'Tester': 1 };
        let highestLevel = 0;

        for (const [roleId, mapping] of Object.entries(roleMappings)) {
            if (userRoles.has(roleId)) {
                const level = permissionHierarchy[mapping.permission] || 0;
                if (level > highestLevel) {
                    highestLevel = level;
                    highestMapping = mapping;
                }
            }
        }

        return highestMapping;
    } catch (error) {
        console.error('Error getting user role mapping:', error);
        return null;
    }
}

async function executeRobloxCommand(discordUserId, robloxUserId, command, args, serverId, discordTag, permission, guildId) {
    const payload = {
        discordUserId,
        robloxUserId,
        command,
        args: args || [],
        serverId,
        discordTag,
        permission,
        guildId
    };
    const path = '/api/command';
    const body = JSON.stringify(payload);

    console.log(`📤 Sending command to game server: ${serverId} (Guild: ${guildId})`);
    console.log('POST URL:', `${SERVER_URL}/api/command`);

    try {
        const response = await axios.post(`${SERVER_URL}${path}`, body, {
            timeout: HTTP_REQUEST_TIMEOUT,
            maxRedirects: 0,
            headers: signedHeaders('POST', path, body)
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

async function getCommandResult(commandId, maxWait = COMMAND_EXECUTION_TIMEOUT) {
    const startTime = Date.now();
    console.log(`[POLL] Waiting for result of command ${commandId} (max ${maxWait / 1000}s)...`);

    let attempts = 0;
    while (Date.now() - startTime < maxWait) {
        attempts++;
        try {
            const path = `/api/result/${encodeURIComponent(commandId)}`;
            const response = await axios.get(`${SERVER_URL}${path}`, {
                timeout: 5000,
                maxRedirects: 0,
                headers: signedHeaders('GET', path)
            });

            const elapsed = Date.now() - startTime;
            console.log(`[POLL] ✅ Got result for ${commandId} after ${elapsed}ms (${attempts} attempts)`);
            return response.data;

        } catch (error) {
            if (error.response?.status !== 404) {
                console.error('[POLL] ❌ Error getting result:', error.message);
                throw error;
            }
            // 404 = result not ready yet → keep polling
        }

        // Wait only 200ms between polls → 5x faster feedback
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    const elapsed = Date.now() - startTime;
    throw new Error(`Command execution timeout after ${elapsed}ms (max: ${maxWait}ms)`);
}

client.on('ready', async () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
    console.log(`🎮 Bot is ready! Use ${PREFIX}<command> <args>`);
    console.log('👑 Supreme User:', SUPREME_USER.discordId);
    console.log('📋 Guild to Game Mapping:');
    Object.entries(GUILD_TO_GAME_MAPPING).forEach(([guildId, gameServer]) => {
        const guild = client.guilds.cache.get(guildId);
        const roleCount = Object.keys(DISCORD_ROLE_MAPPING[guildId] || {}).length;
        console.log(`  ${guild ? guild.name : 'Unknown'} (${guildId}) → ${gameServer} [${roleCount} roles configured]`);
    });
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

// Safety net: several async event handlers below await message.reply(...) /
// sendTyping() outside a try/catch, so a single failed Discord API call (e.g.
// missing permissions) would reject with no handler and, on modern Node, crash
// the whole bot. Log the rejection and keep the process alive instead. This
// only affects error resilience; command routing and behavior are unchanged.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    if (!message.guild) {
        return message.reply('❌ Commands can only be used in server channels, not DMs');
    }

    const guildId = message.guild.id;
    const gameServerId = getGameServerFromGuild(guildId);

    if (gameServerId === 'unknown_server') {
        return message.reply('❌ This Discord server is not configured for Roblox commands');
    }

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    if (['help', 'serverinfo', 'roles'].includes(command)) return;

    let member;
    try {
        member = await message.guild.members.fetch(message.author.id);
    } catch (error) {
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Error')
            .setDescription('Could not fetch your Discord member information')
            .setTimestamp();

        return message.reply({ embeds: [errorEmbed] });
    }

    const roleMapping = await getUserRoleMapping(member, guildId);

    if (!roleMapping) {
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Unauthorized')
            .setDescription('You need one of the following roles:\n• Owner\n• HeadAdmin\n• Admin\n• Tester')
            .setTimestamp();

        return message.reply({ embeds: [errorEmbed] });
    }

    const now = Date.now();
    const lastCommand = recentCommandAt.get(message.author.id) || 0;
    if (now - lastCommand < USER_COMMAND_COOLDOWN_MS) {
        return message.reply('❌ Please wait a few seconds before sending another command.');
    }
    if (activeCommands >= MAX_ACTIVE_COMMANDS) {
        return message.reply('❌ The command bridge is busy. Try again shortly.');
    }
    recentCommandAt.set(message.author.id, now);
    if (recentCommandAt.size > 5000) {
        for (const [userId, timestamp] of recentCommandAt) {
            if (now - timestamp > COMMAND_EXECUTION_TIMEOUT) recentCommandAt.delete(userId);
        }
    }

    // 👑 Log supreme access
    const isSupreme = roleMapping.isSupreme ? ' 👑 SUPREME' : '';
    console.log(`📝 Command from ${message.author.tag} (${roleMapping.permission}${isSupreme}) in ${message.guild.name}: ${command} ${args.join(' ')}`);

    await message.channel.sendTyping();

    activeCommands += 1;
    try {
        const commandId = await executeRobloxCommand(
            message.author.id,
            roleMapping.robloxUserId,
            command,
            args,
            gameServerId,
            message.author.tag,
            roleMapping.permission,
            guildId
        );

        console.log(`Command sent successfully, ID: ${commandId}`);

        const embed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('🔄 Command Sent')
            .setDescription(`Command: \`${PREFIX}${command}${args.length > 0 ? ' ' + args.join(' ') : ''}\``)
            .addFields(
                { name: 'Command ID', value: commandId, inline: true },
                { name: 'Permission', value: roleMapping.permission + isSupreme, inline: true },
                { name: 'Game Server', value: gameServerId, inline: true }
            )
            .setTimestamp();

        const sentMessage = await message.reply({ embeds: [embed] });

        try {
            const result = await getCommandResult(commandId);

            const resultEmbed = new EmbedBuilder()
                .setTitle(result.success ? '✅ Command Executed' : '❌ Command Failed')
                .setColor(result.success ? '#00ff00' : '#ff0000')
                .setDescription(`Command: \`${PREFIX}${command}${args.length > 0 ? ' ' + args.join(' ') : ''}\``)
                .addFields(
                    { name: 'Permission', value: roleMapping.permission + isSupreme, inline: true },
                    { name: 'Virtual User ID', value: roleMapping.robloxUserId.toString(), inline: true },
                    { name: 'Game Server', value: gameServerId, inline: true },
                    { name: 'Result', value: result.result || result.error || 'No output', inline: false }
                )
                .setTimestamp();

            await sentMessage.edit({ embeds: [resultEmbed] });
        } catch (resultError) {
            console.error('Result error:', resultError.message);
            const timeoutEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⏰ Command Timeout')
                .setDescription(`Command was sent but no response received within ${COMMAND_EXECUTION_TIMEOUT / 1000} seconds`)
                .addFields(
                    { name: 'Original Command', value: `\`${PREFIX}${command}${args.length > 0 ? ' ' + args.join(' ') : ''}\``, inline: false },
                    { name: 'Permission', value: roleMapping.permission + isSupreme, inline: true },
                    { name: 'Game Server', value: gameServerId, inline: true }
                )
                .setTimestamp();

            await sentMessage.edit({ embeds: [timeoutEmbed] });
        }

    } catch (error) {
        console.error('Command error:', error.message);
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Error')
            .setDescription(error.message)
            .addFields(
                { name: 'Command', value: `\`${PREFIX}${command}${args.length > 0 ? ' ' + args.join(' ') : ''}\``, inline: false },
                { name: 'Permission', value: roleMapping.permission + isSupreme, inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [errorEmbed] });
    } finally {
        activeCommands -= 1;
    }
});

client.on('messageCreate', async message => {
    if (message.content === `${PREFIX}help` && !message.author.bot) {
        if (!message.guild) return;

        const guildId = message.guild.id;
        const gameServerId = getGameServerFromGuild(guildId);

        let member;
        let roleMapping = null;

        try {
            member = await message.guild.members.fetch(message.author.id);
            roleMapping = await getUserRoleMapping(member, guildId);
        } catch (error) {
            console.error('Error in help command:', error);
        }

        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🤖 Roblox Command Bot Help')
            .setDescription(`Use \`${PREFIX}<command> <args>\` to execute Roblox commands`)
            .addFields(
                { name: 'Examples', value: `\`${PREFIX}ban username\`\n\`${PREFIX}kick username\`\n\`${PREFIX}fling all\`\n\`${PREFIX}tp username1 username2\``, inline: false },
                { name: 'Available Commands', value: 'All Roblox admin commands are supported!', inline: false },
                { name: 'Required Roles', value: '• **Owner** - Full access\n• **HeadAdmin** - High-level commands\n• **Admin** - Standard admin commands\n• **Tester** - Basic commands', inline: false },
                { name: 'Target Game', value: gameServerId, inline: true },
                { name: 'Discord Server', value: message.guild.name, inline: true }
            )
            .setTimestamp();

        if (roleMapping) {
            const isSupreme = roleMapping.isSupreme ? ' 👑 SUPREME' : '';
            helpEmbed.addFields({
                name: 'Your Permission Level',
                value: `**${roleMapping.permission}${isSupreme}** (Virtual User ID: ${roleMapping.robloxUserId})`,
                inline: false
            });
        } else {
            helpEmbed.addFields({
                name: 'Your Status',
                value: '❌ No permission - You need a configured role',
                inline: false
            });
        }

        await message.reply({ embeds: [helpEmbed] });
    }
});

client.on('messageCreate', async message => {
    if (message.content === `${PREFIX}serverinfo` && !message.author.bot) {
        if (!message.guild) return;

        const guildId = message.guild.id;
        const gameServerId = getGameServerFromGuild(guildId);
        const roleMappings = getRoleMappingForGuild(guildId);
        const roleCount = Object.keys(roleMappings).length;

        const serverInfoEmbed = new EmbedBuilder()
            .setColor('#9932cc')
            .setTitle('🎮 Server Information')
            .addFields(
                { name: 'Discord Server', value: message.guild.name, inline: true },
                { name: 'Guild ID', value: guildId, inline: true },
                { name: 'Roblox Game', value: gameServerId, inline: true },
                { name: 'Configured Roles', value: roleCount.toString(), inline: true }
            )
            .setTimestamp();

        await message.reply({ embeds: [serverInfoEmbed] });
    }
});

client.on('messageCreate', async message => {
    if (message.content === `${PREFIX}roles` && !message.author.bot) {
        if (!message.guild) return;

        const guildId = message.guild.id;
        const roleMappings = getRoleMappingForGuild(guildId);

        let member;
        let userRoleMapping = null;

        try {
            member = await message.guild.members.fetch(message.author.id);
            userRoleMapping = await getUserRoleMapping(member, guildId);
        } catch (error) {
            console.error('Error in roles command:', error);
        }

        const rolesEmbed = new EmbedBuilder()
            .setColor('#9932cc')
            .setTitle('🎭 Discord Role Information')
            .setDescription('Role mappings for Roblox command execution')
            .setTimestamp();

        // Add configured roles
        for (const [roleId, mapping] of Object.entries(roleMappings)) {
            const role = message.guild.roles.cache.get(roleId);
            const roleName = role ? role.name : `Unknown (${roleId})`;
            rolesEmbed.addFields({
                name: mapping.permission,
                value: `<@&${roleId}> (${roleName})\nRoblox UserId: ${mapping.robloxUserId}`,
                inline: true
            });
        }

        if (userRoleMapping) {
            const isSupreme = userRoleMapping.isSupreme ? ' 👑 SUPREME' : '';
            rolesEmbed.addFields({
                name: 'Your Current Role',
                value: `**${userRoleMapping.permission}${isSupreme}** (Roblox UserId: ${userRoleMapping.robloxUserId})`,
                inline: false
            });
            rolesEmbed.setColor('#00ff00');
        } else {
            rolesEmbed.addFields({
                name: 'Your Current Role',
                value: '❌ No permission role detected',
                inline: false
            });
            rolesEmbed.setColor('#ff0000');
        }

        await message.reply({ embeds: [rolesEmbed] });
    }
});

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

            const waitTime = 5000 * (i + 1);
            console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

connectWithRetry();
