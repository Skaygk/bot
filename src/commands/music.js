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

async function searchAndGetUrl(query) {
  const isUrl = query.startsWith('http');
  const target = isUrl ? query : `ytsearch1:${query}`;

  return new Promise((resolve, reject) => {
    const args = [
      target,
      '-f', 'bestaudio',
      '--get-url',
      '--get-title',
      '--no-playlist',
      '--no-warnings',
      '--extractor-args', 'youtube:skip=dash',
    ];

    if (fs.existsSync(COOKIES_PATH)) {
      args.push('--cookies', COOKIES_PATH);
    }

    const proc = spawn(YTDLP_PATH, args);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[yt-dlp stderr]', stderr);
        return reject(new Error('yt-dlp fallo: ' + stderr));
      }
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length < 2) return reject(new Error('No se encontraron resultados'));
      const title = lines[0];
      const url = lines[lines.length - 1];
      resolve({ title, url });
    });

    proc.on('error', reject);
  });
}

function getStream(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', url,
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ];

    const proc = spawn(ffmpegStatic, args);
    proc.on('error', (err) => {
      console.error('[ffmpeg] Error:', err);
      reject(err);
    });
    resolve(proc.stdout);
  });
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
    const { title, url } = await searchAndGetUrl(query);
    const stream = await getStream(url);

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
    console.error('[play] Error:', err);
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
