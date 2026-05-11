/**
 * music.js — Módulo de música con Lavalink + Shoukaku
 * Requiere que client.shoukaku esté inicializado en index.js
 */

const { EmbedBuilder } = require('discord.js');

// ─── Helper: obtener/crear cola por servidor ─────────────────────────────────
function getQueue(client, guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      player: null,
      tracks: [],
      playing: false,
      volume: 100,
    });
  }
  return client.musicQueues.get(guildId);
}

// ─── Helper: obtener nodo Lavalink disponible ────────────────────────────────
function getNode(client) {
  const node = client.shoukaku.getIdealNode();
  if (!node) throw new Error('No hay nodos Lavalink disponibles en este momento.');
  return node;
}

// ─── Helper: buscar track en Lavalink ───────────────────────────────────────
async function searchTrack(node, query) {
  const isUrl = /^https?:\/\//i.test(query);

  // URL directa → cargar tal cual; texto → buscar en YouTube Music con fallback a YouTube
  const searchQuery = isUrl ? query : `ytmsearch:${query}`;
  const result = await node.rest.resolve(searchQuery);

  if (!result || !result.data) throw new Error('Sin resultados de Lavalink.');

  const { loadType } = result;

  if (loadType === 'error' || loadType === 'empty') {
    // Fallback a búsqueda estándar de YouTube
    if (!isUrl) {
      const fallback = await node.rest.resolve(`ytsearch:${query}`);
      if (!fallback?.data || fallback.loadType === 'empty' || fallback.loadType === 'error') {
        throw new Error('No se encontró ningún resultado para esa búsqueda.');
      }
      return fallback.loadType === 'search' ? fallback.data[0] : fallback.data;
    }
    throw new Error('No se encontró ningún resultado para esa búsqueda.');
  }

  if (loadType === 'search')   return result.data[0];
  if (loadType === 'track')    return result.data;
  if (loadType === 'playlist') return result.data.tracks[0];

  throw new Error('Tipo de resultado desconocido.');
}

// ─── Helper: formatear duración ms → mm:ss ───────────────────────────────────
function formatDuration(ms) {
  if (!ms) return '?:??';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

// ─── Helper: reproducir siguiente track en cola ──────────────────────────────
async function playNext(client, guildId, textChannel) {
  const queue = getQueue(client, guildId);

  if (!queue.tracks.length) {
    queue.playing = false;
    return;
  }

  const track = queue.tracks.shift();

  try {
    await queue.player.playTrack({ track: { encoded: track.encoded } });
    queue.playing = true;

    const title    = track.info?.title  ?? 'Desconocido';
    const author   = track.info?.author ?? '';
    const uri      = track.info?.uri    ?? '';
    const duration = formatDuration(track.info?.length ?? 0);

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle(' Reproduciendo ahora')
      .setDescription(`**[${title}${author ? ` — ${author}` : ''}](${uri})**`)
      .addFields({ name: 'Duración', value: duration, inline: true })
      .setTimestamp();

    textChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[playNext] Error:', err.message);
    queue.playing = false;
    playNext(client, guildId, textChannel); // intentar siguiente
  }
}

// ─── Helper: crear player y adjuntar eventos ─────────────────────────────────
async function createPlayer(client, message, voiceChannel) {
  const node = getNode(client);
  const queue = getQueue(client, message.guild.id);

  const player = await node.joinChannel({
    guildId: message.guild.id,
    channelId: voiceChannel.id,
    shardId: message.guild.shardId ?? 0,
    deaf: true,
  });

  queue.player = player;

  player.on('end', () => {
    playNext(client, message.guild.id, message.channel);
  });

  player.on('error', (err) => {
    console.error('[Lavalink Player] Error:', err.message);
    message.channel.send(`Error en el reproductor: ${err.message}`).catch(() => {});
    playNext(client, message.guild.id, message.channel);
  });

  player.on('close', () => {
    client.musicQueues.delete(message.guild.id);
  });

  return player;
}

// ─── Helper: destruir queue y desconectar ────────────────────────────────────
async function destroyQueue(client, guildId) {
  const queue = client.musicQueues.get(guildId);
  if (!queue) return;
  if (queue.player) {
    queue.player.connection.disconnect();
    await queue.player.destroyPlayer().catch(() => {});
  }
  client.musicQueues.delete(guildId);
}

// ────────────────────────────────────────────────────────────────────────────
// Comandos
// ────────────────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send(' No estás en un canal de voz.');

  const queue = getQueue(client, message.guild.id);
  if (queue.player) return message.channel.send('Ya estoy en un canal de voz.');

  try {
    await createPlayer(client, message, voiceChannel);
    message.channel.send(`Me uní a **${voiceChannel.name}**.`);
  } catch (err) {
    console.error('[join] Error:', err.message);
    message.channel.send(` No pude unirme: ${err.message}`);
  }
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send(' No estás en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Especifica una canción. Uso: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  // Unirse al canal si no hay player activo
  if (!queue.player) {
    try {
      await createPlayer(client, message, voiceChannel);
    } catch (err) {
      console.error('[play] Error al unirse:', err.message);
      return message.channel.send(`No pude unirme al canal: ${err.message}`);
    }
  }

  const loadingMsg = await message.channel.send('🔍 Buscando canción...');

  try {
    const node  = getNode(client);
    const track = await searchTrack(node, query);

    const title    = track.info?.title  ?? 'Desconocido';
    const author   = track.info?.author ?? '';
    const duration = formatDuration(track.info?.length ?? 0);
    const uri      = track.info?.uri    ?? '';

    queue.tracks.push(track);
    await loadingMsg.delete().catch(() => {});

    if (queue.playing) {
      // Ya hay algo sonando → agregar a cola
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(' Agregado a la cola')
        .setDescription(`**[${title}${author ? ` — ${author}` : ''}](${uri})**`)
        .addFields(
          { name: 'Duración', value: duration, inline: true },
          { name: 'Posición en cola', value: `#${queue.tracks.length}`, inline: true },
        )
        .setFooter({ text: `Solicitado por ${message.author.tag}` })
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } else {
      // Nada sonando → reproducir de inmediato
      playNext(client, message.guild.id, message.channel);
    }
  } catch (err) {
    console.error('[play] Error:', err.message);
    await loadingMsg.delete().catch(() => {});
    message.channel.send(` No pude reproducir esa canción: ${err.message}`);
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send(' No hay nada reproduciéndose.');
  }
  await queue.player.setPaused(true);
  queue.playing = false;
  message.channel.send('⏸ Canción pausada.');
}

async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player) {
    return message.channel.send(' No hay nada pausado.');
  }
  await queue.player.setPaused(false);
  queue.playing = true;
  message.channel.send(' Canción reanudada.');
}

async function stop(client, message) {
  const queue = client.musicQueues.get(message.guild.id);
  if (!queue?.player) return message.channel.send(' No hay nada reproduciéndose.');
  queue.tracks = [];
  await destroyQueue(client, message.guild.id);
  message.channel.send(' Reproducción detenida.');
}

async function skip(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciéndose.');
  }
  await queue.player.stopTrack(); // dispara evento 'end' → playNext automático
  message.channel.send(' Canción saltada.');
}

function showQueue(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.tracks.length) return message.channel.send('La cola está vacía.');

  const list = queue.tracks
    .slice(0, 10)
    .map((t, i) => {
      const title = t.info?.title ?? 'Desconocido';
      const dur   = formatDuration(t.info?.length ?? 0);
      return `**${i + 1}.** ${title} \`[${dur}]\``;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('🎵 Cola de reproducción')
    .setDescription(list + (queue.tracks.length > 10 ? `\n...y ${queue.tracks.length - 10} más.` : ''))
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

module.exports = { join, play, pause, resume, stop, skip, showQueue };const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const playdl = require('play-dl');

// ─── Inicializar SoundCloud ──────────────────────────────────────────────────
(async () => {
  try {
    const id = await playdl.getFreeClientID();
    await playdl.setToken({ soundcloud: { client_id: id } });
    console.log('[play-dl] SoundCloud client_id configurado:', id);
  } catch (e) {
    console.warn('[play-dl] Error al inicializar SoundCloud:', e.message);
  }
})();

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

async function searchSoundCloud(query) {
  const isUrl = query.startsWith('http');

  if (isUrl) {
    // URL directa de soundcloud.com
    const info = await playdl.soundcloud(query);
    return { title: info.name, url: info.permalink };
  }

  const results = await playdl.search(query, {
    source: { soundcloud: 'tracks' },
    limit: 1,
  });

  if (!results || results.length === 0) throw new Error('Sin resultados');

  const track = results[0];
  console.log('[sc] Track permalink:', track.permalink);
  console.log('[sc] Track url:', track.url);

  // Usar permalink (URL publica de soundcloud.com) en vez de la URL de API interna
  const permalink = track.permalink;
  if (!permalink) throw new Error('No se pudo obtener URL del track');

  return { title: track.name, url: permalink };
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
    const { title, url } = await searchSoundCloud(query);

    console.log('[play] Titulo:', title);
    console.log('[play] URL final:', url);

    const stream = await playdl.stream(url);

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
