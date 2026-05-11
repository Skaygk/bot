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
const ffmpegStatic = require('ffmpeg-static');
const YTDlpWrap = require('yt-dlp-wrap').default;

// ─── yt-dlp singleton ───────────────────────────────────────────────────────
let ytDlp = null;

async function getYtDlp() {
  if (!ytDlp) {
    ytDlp = new YTDlpWrap();
    try {
      await YTDlpWrap.downloadFromGithub();
      console.log('[yt-dlp] Binario descargado correctamente.');
    } catch (e) {
      console.warn('[yt-dlp] No se pudo descargar el binario:', e.message);
    }
  }
  return ytDlp;
}

// Llama esto una vez al arrancar el bot (desde index.js o aquí al cargar el módulo)
getYtDlp();

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
  const yt = await getYtDlp();
  const isUrl = query.startsWith('http');
  const target = isUrl ? query : `ytsearch1:${query}`;

  const output = await yt.execPromise([
    target,
    '-f', 'bestaudio',
    '--get-url',
    '--get-title',
    '--no-playlist',
    '--no-warnings',
  ]);

  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error('No results found');

  const title = lines[0];
  const url = lines[lines.length - 1];
  return { title, url };
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
      console.error('[ffmpeg] Error al spawnear:', err);
      reject(err);
    });

    proc.stderr.on('data', (data) => {
      // Descomenta para debug:
      // console.error('[ffmpeg stderr]', data.toString());
    });

    resolve(proc.stdout);
  });
}

// ─── Comandos ────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    return message.channel.send('No estás en un canal de voz.');
  }

  const queue = getQueue(client, message.guild.id);

  if (queue.connection) {
    return message.channel.send('Ya estoy en un canal de voz vro');
  }

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

  message.channel.send(`Me uní a **${voiceChannel.name}**.`);
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    return message.channel.send('No estás en un canal de voz wey');
  }

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) {
    return message.channel.send('Especifica una canción. Uso: `,play <nombre o URL>`');
  }

  const queue = getQueue(client, message.guild.id);

  // Unirse al canal si no está conectado
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

  // Mensaje de carga
  const loadingMsg = await message.channel.send('Buscando canción :p');

  try {
    const { title, url } = await searchAndGetUrl(query);
    const stream = await getStream(url);

    const resource = createAudioResource(stream, {
      inputType: 'raw',
    });

    if (!queue.player) {
      queue.player = createAudioPlayer();
      queue.connection.subscribe(queue.player);
    }

    queue.player.removeAllListeners(AudioPlayerStatus.Idle);
    queue.player.removeAllListeners('error');

    queue.player.play(resource);
    queue.playing = true;

    queue.player.on(AudioPlayerStatus.Idle, () => {
      queue.playing = false;
    });

    queue.player.on('error', (err) => {
      console.error('[player] Error:', err);
      queue.playing = false;
    });

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('🎵 Reproduciendo')
      .setDescription(`**${title}**`)
      .setFooter({ text: `Solicitado por ${message.author.tag}` })
      .setTimestamp();

    await loadingMsg.delete().catch(() => {});
    message.channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('[play] Error:', err);
    await loadingMsg.delete().catch(() => {});
    message.channel.send('ulu no pudo reproducir esa canción');
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);

  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing) {
    return message.channel.send('No hay nada reproduciéndose.');
  }

  queue.player.pause();
  queue.playing = false;
  message.channel.send('pausada.');
}

async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);

  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Paused) {
    return message.channel.send('No hay nada pausado.');
  }

  queue.player.unpause();
  queue.playing = true;
  message.channel.send('reanudada.');
}

async function stop(client, message) {
  const queue = getQueue(client, message.guild.id);

  if (!queue.player) {
    return message.channel.send('No hay nada reproduciéndose.');
  }

  queue.player.stop();
  queue.playing = false;

  if (queue.connection) {
    queue.connection.destroy();
  }

  client.musicQueues.delete(message.guild.id);
  message.channel.send('Reproducción detenida.');
}

module.exports = { join, play, pause, resume, stop };
