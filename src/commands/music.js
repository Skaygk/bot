const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const playdl = require('play-dl');

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
    // Buscar por nombre o URL directa
    let videoUrl;
    let title;

    const isUrl = query.startsWith('http');

    if (isUrl) {
      // Es una URL directa de YouTube
      const info = await playdl.video_info(query);
      title = info.video_details.title;
      videoUrl = query;
    } else {
      // Buscar por nombre
      const results = await playdl.search(query, { limit: 1 });
      if (!results || results.length === 0) {
        await loadingMsg.delete().catch(() => {});
        return message.channel.send('No encontre resultados para esa busqueda.');
      }
      title = results[0].title;
      videoUrl = results[0].url;
    }

    console.log('[play] Titulo:', title);
    console.log('[play] URL:', videoUrl);

    // Obtener stream directo con play-dl
    const stream = await playdl.stream(videoUrl, { quality: 2 });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

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
