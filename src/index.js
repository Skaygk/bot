require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');

// ─── Nodos Lavalink públicos ─────────────────────────────────────────────────
// Si alguno falla, Shoukaku hace failover automático al siguiente.
// Lista actualizada: https://lavalink.darrennathanael.com/NoSSL/lavalink-without-ssl/
const LAVALINK_NODES = [
  {
    name: 'node-1',
    url: 'lavalink.jiveoff.fr:2333',
    auth: 'youshallnotpass',
    secure: false,
  },
  {
    name: 'node-2',
    url: 'lava.link:80',
    auth: 'dismusic',
    secure: false,
  },
  {
    name: 'node-3',
    url: 'lavalink.clxud.dev:2333',
    auth: 'youshallnotpass',
    secure: false,
  },
];

const SHOUKAKU_OPTIONS = {
  moveOnDisconnect: false,
  resumable: false,
  resumableTimeout: 30,
  reconnectTries: 3,
  restTimeout: 10000,
};

// ─── Cliente Discord ─────────────────────────────────────────────────────────
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

// ─── Inicializar Shoukaku (Lavalink) ─────────────────────────────────────────
client.shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  LAVALINK_NODES,
  SHOUKAKU_OPTIONS,
);

client.shoukaku.on('error', (name, err) => {
  console.error(`[Lavalink:${name}] Error: ${err.message}`);
});

client.shoukaku.on('ready', (name) => {
  console.log(`[Lavalink:${name}] Nodo conectado correctamente.`);
});

client.shoukaku.on('disconnect', (name, count) => {
  console.warn(`[Lavalink:${name}] Desconectado. Reconexiones restantes: ${count}`);
});

// ─── Handlers ────────────────────────────────────────────────────────────────
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
