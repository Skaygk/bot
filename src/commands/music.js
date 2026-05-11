const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegStatic = require('ffmpeg-static');

// ─── Cookies desde variable de entorno ──────────────────────────────────────
const COOKIES_PATH = path.join('/tmp', 'cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
  fs.writeFileSync(COOKIES_PATH, process.env.YOUTUBE_COOKIES);
  console.log('[cookies] Archivo de cookies creado en:', COOKIES_PATH);
} else {
  console.warn('[cookies] No se encontro la variable YOUTUBE_COOKIES.');
}

// ─── yt-dlp ─────────────────────────────────────────────────────────────────
const YTDLP_PATH = '/usr/local/bin/yt-dlp';

// ─── Helpers ────────────────────────────────────────────────────────────────
function getQueue(client, guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      connection: null,
      player: null,
      playing: false,
    });
  }
  return client.musicQueues.get(guildId);
}

// Obtiene solo el titulo de la cancion
async function getTitle(query) {
  const isUrl = query.startsWith('http');
  const target = isUrl ? query : `ytsearch1:${query}`;

  return new Promise((resolve, reject) => {
    const args = [
      target,
      '--print', 'title',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
    ];

    if (fs.existsSync(COOKIES_PATH)) args.push('--cookies', COOKIES_PATH);

    const proc = spawn(YTDLP_PATH, args);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('No se pudo obtener el titulo'));
      resolve(out.trim().split('\n')[0] || 'Sin titulo');
    });
    proc.on('error', reject);
  });
}

// yt-dlp descarga audio y lo pipa directo a ffmpeg
// No necesita obtener URL ni preocuparse por formatos
function getStream(query) {
  const isUrl = query.startsWith('http');
  const target = isUrl ? query : `ytsearch1:${query}`;

  const ytdlpArgs = [
    target,
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '-o', '-',          // output a stdout
    '-f', 'bestaudio',  // yt-dlp elige el mejor audio disponible internamente
    '-q',               // silencioso
  ];

  if (fs.existsSync(COOKIES_PATH)) ytdlpArgs.push('--cookies', COOKIES_PATH);

  const ffmpegArgs = [
    '-i', 'pipe:0',       // lee desde stdin (pipe de yt-dlp)
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',             // output a stdout
  ];

  const ytdlp = spawn(YTDLP_PATH, ytdlpArgs);
  const ffmpeg = spawn(ffmpegStatic, ffmpegArgs);

  // Conectar yt-dlp stdout → ffmpeg stdin
  ytdlp.stdout.pipe(ffmpeg.stdin);

  ytdlp.on('error', (err) => console.error('[yt-dlp] Error:', err));
  ffmpeg.on('error', (err) => console.error('[ffmpeg] Error:', err));

  ytdlp.stderr.on('data', (d) => console.error('[yt-dlp stderr]', d.toString()));

  // Si yt-dlp termina con error, cerrar ffmpeg
  ytdlp.on('close', (code) => {
    if (code !== 0) ffmpeg.stdin.destroy();
  });

  return ffmpeg.stdout;
}

// ─── Comandos ────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const queue = getQueue(client, message.guild.id);
  if (queue.connection) return message.channel.send('Ya estoy en un canal de voz.');

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
  });

  queue.connection = connection;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      client.musicQueues.delete(message.guild.id);
    }
  });

  message.channel.send(`Me uni a **${voiceChannel.name}**.`);
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Especifica una cancion. Uso: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  if (!queue.connection) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    queue.connection = connection;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        client.musicQueues.delete(message.guild.id);
      }
    });
  }

  const loadingMsg = await message.channel.send('Buscando cancion...');

  try {
    // Obtener titulo y stream en paralelo para ser mas rapido
    const [title, stream] = await Promise.all([
      getTitle(query),
      Promise.resolve(getStream(query)),
    ]);

    console.log('[play] Titulo:', title);

    const resource = createAudioResource(stream, { inputType: 'raw' });

    if (!queue.player) {
      queue.player = createAudioPlayer();
      queue.connection.subscribe(queue.player);
    }

    queue.player.removeAllListeners(AudioPlayerStatus.Idle);
    queue.player.removeAllListeners('error');

    queue.player.play(resource);
    queue.playing = true;

    queue.player.on(AudioPlayerStatus.Idle, () => { queue.playing = false; });
    queue.player.on('error', (err) => {
      console.error('[player] Error:', err);
      queue.playing = false;
    });

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('Reproduciendo')
      .setDescription(`**${title}**`)
      .setFooter({ text: `Solicitado por ${message.author.tag}` })
      .setTimestamp();

    await loadingMsg.delete().catch(() => {});
    message.channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('[play] Error completo:', err.message);
    await loadingMsg.delete().catch(() => {});
    message.channel.send('No pude reproducir esa cancion. Intenta con otro link o nombre.');
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing) {
    return message.channel.send('No hay nada reproduciendose.');
  }
  queue.player.pause();
  queue.playing = false;
  message.channel.send('Cancion pausada.');
}

async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Paused) {
    return message.channel.send('No hay nada pausado.');
  }
  queue.player.unpause();
  queue.playing = true;
  message.channel.send('Cancion reanudada.');
}

async function stop(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player) return message.channel.send('No hay nada reproduciendose.');

  queue.player.stop();
  queue.playing = false;

  if (queue.connection) queue.connection.destroy();

  client.musicQueues.delete(message.guild.id);
  message.channel.send('Reproduccion detenida.');
}

module.exports = { join, play, pause, resume, stop };
