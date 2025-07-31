import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function sendBanRequest(username, reason) {
  const SERVER_URL = process.env.SERVER_URL;
  if (!SERVER_URL) {
    console.error("❌ SERVER_URL is not defined in .env!");
    return;
  }

  const body = {
    command: "ban",
    arguments: {
      username,
      reason,
    },
  };

  try {
    const response = await fetch(`${SERVER_URL}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    console.log(`✅ Ban request sent for ${username}`);
  } catch (error) {
    console.error("❌ Failed to send ban request:", error);
  }
}

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ban') {
    const username = interaction.options.getString('username');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    await sendBanRequest(username, reason);
    await interaction.reply(`🔨 Ban request for \`${username}\` submitted.`);
  }
});

async function connectWithRetry(retries = 5, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    console.log(`[BOT] 🔄 Attempting to connect to Discord (attempt ${i + 1}/${retries})...`);
    console.log("🟡 Attempting login now...");
    console.log("🔑 Token length:", process.env.DISCORD_TOKEN?.length);
    console.log("🌐 Server URL:", process.env.SERVER_URL);
    try {
      await client.login(process.env.DISCORD_TOKEN);
      return;
    } catch (error) {
      console.error(`❌ Connection attempt ${i + 1} failed:`, error);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  console.error("🚫 Failed to connect to Discord after multiple attempts.");
  process.exit(1);
}

connectWithRetry();
