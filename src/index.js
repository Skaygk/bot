require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');

// ─── Nodos Lavalink públicos ─────────────────────────────────────────────────
const LAVALINK_NODES = [
  {
    name: 'nexcloud',
    url:  'n3.nexcloud.in:2026',
    auth: 'nexcloud',
    secure: false,
  },
  {
    name: 'jirayu',
    url:  'lavalink.jirayu.net:13592',
    auth: 'youshallnotpass',
    secure: false,
  },
  {
    name: 'serenetia',
    url:  'lavalinkv4.serenetia.com:80',
    auth: 'https://dsc.gg/ajidevserver',
    secure: false,
  },
  {
    name: 'vexanode',
    url:  'omega.vexanode.cloud:2031',
    auth: 'https://discord.vexanode.cloud',
    secure: false,
  },
];

const SHOUKAKU_OPTIONS = {
  moveOnDisconnect:  false,
  resumable:         false,
  resumableTimeout:  30,
  reconnectTries:    3,
  restTimeout:       10000,
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
const { handleCommand }      = require('./handler');
const { handleMemberUpdate } = require('./events/memberUpdate');
const { handleVoiceStateUpdate } = require('./commands/music');

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

// Detectar VC vacío → salir en 1 minuto
client.on('voiceStateUpdate', (oldState, newState) => {
  handleVoiceStateUpdate(client, oldState, newState);
});

client.login(process.env.DISCORD_TOKEN);
