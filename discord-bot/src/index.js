require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildBans,
  ],
  partials: [Partials.GuildMember],
});

client.musicQueues = new Collection();
client.forcedNames = new Collection(); // userId -> forcedName

const { handleCommand } = require('./handler');
const { handleMemberUpdate } = require('./events/memberUpdate');

client.on('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(',') || message.author.bot) return;
  await handleCommand(client, message);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  await handleMemberUpdate(client, oldMember, newMember);
});

client.login(process.env.DISCORD_TOKEN);
