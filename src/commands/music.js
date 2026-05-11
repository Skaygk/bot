/**
 * music.js — Módulo de música con Lavalink + Shoukaku v4
 * Requiere que client.shoukaku esté inicializado en index.js
 *
 * API correcta de Shoukaku v4:
 *   - joinVoiceChannel()  → en client.shoukaku, NO en el nodo
 *   - rest.resolve()      → en node O en player.node después de conectar
 */

const { EmbedBuilder } = require('discord.js');

// ─── Helper: obtener/crear cola por servidor ─────────────────────────────────
function getQueue(client, guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      player: null,
      tracks: [],
      playing: false,
    });
  }
  return client.musicQueues.get(guildId);
}

// ─── Helper: obtener nodo disponible ────────────────────────────────────────
function getNode(client) {
  const node = client.shoukaku.getIdealNode();
  if (!node) throw new Error('No hay nodos Lavalink disponibles en este momento.');
  return node;
}

// ─── Helper: buscar track ────────────────────────────────────────────────────
async function searchTrack(node, query) {
  const isUrl = /^https?:\/\//i.test(query);
  const searchQuery = isUrl ? query : `ytmsearch:${query}`;

  const result = await node.rest.resolve(searchQuery);
  if (!result || !result.data) throw new Error('Sin resultados de Lavalink.');

  const { loadType } = result;

  if (loadType === 'error' || loadType === 'empty') {
    if (!isUrl) {
      const fallback = await node.rest.resolve(`ytsearch:${query}`);
      if (!fallback?.data || fallback.loadType === 'empty' || fallback.loadType === 'error') {
        throw new Error('No se encontró ningún resultado.');
      }
      return fallback.loadType === 'search' ? fallback.data[0] : fallback.data;
    }
    throw new Error('No se encontró ningún resultado.');
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

// ─── Helper: reproducir siguiente track ─────────────────────────────────────
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
      .setTitle('Reproduciendo ahora')
      .setDescription(`**[${title}${author ? ` — ${author}` : ''}](${uri})**`)
      .addFields({ name: 'Duración', value: duration, inline: true })
      .setTimestamp();

    textChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[playNext] Error:', err.message);
    queue.playing = false;
    playNext(client, guildId, textChannel);
  }
}

// ─── Helper: crear player con la API correcta de Shoukaku v4 ─────────────────
// En v4: client.shoukaku.joinVoiceChannel(), NO node.joinChannel()
async function createPlayer(client, message, voiceChannel) {
  const queue = getQueue(client, message.guild.id);

  const player = await client.shoukaku.joinVoiceChannel({
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
    console.error('[Player] Error:', err.message);
    message.channel.send(`Error en el reproductor: ${err.message}`).catch(() => {});
    playNext(client, message.guild.id, message.channel);
  });

  player.on('close', () => {
    client.musicQueues.delete(message.guild.id);
  });

  return player;
}

// ─── Helper: destruir queue ──────────────────────────────────────────────────
async function destroyQueue(client, guildId) {
  const queue = client.musicQueues.get(guildId);
  if (!queue) return;
  if (queue.player) {
    await client.shoukaku.leaveVoiceChannel(guildId).catch(() => {});
  }
  client.musicQueues.delete(guildId);
}

// ────────────────────────────────────────────────────────────────────────────
// Comandos
// ────────────────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estás en un canal de voz.');

  const queue = getQueue(client, message.guild.id);
  if (queue.player) return message.channel.send('Ya estoy en un canal de voz.');

  try {
    await createPlayer(client, message, voiceChannel);
    message.channel.send(`Me uní a **${voiceChannel.name}**.`);
  } catch (err) {
    console.error('[join] Error:', err.message);
    message.channel.send(`No pude unirme: ${err.message}`);
  }
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estás en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Uso: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  if (!queue.player) {
    try {
      await createPlayer(client, message, voiceChannel);
    } catch (err) {
      console.error('[play] Error al unirse:', err.message);
      return message.channel.send(`No pude unirme al canal: ${err.message}`);
    }
  }

  const loadingMsg = await message.channel.send('Buscando canción...');

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
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Agregado a la cola')
        .setDescription(`**[${title}${author ? ` — ${author}` : ''}](${uri})**`)
        .addFields(
          { name: 'Duración', value: duration, inline: true },
          { name: 'Posición', value: `#${queue.tracks.length}`, inline: true },
        )
        .setFooter({ text: `Solicitado por ${message.author.tag}` })
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } else {
      playNext(client, message.guild.id, message.channel);
    }
  } catch (err) {
    console.error('[play] Error:', err.message);
    await loadingMsg.delete().catch(() => {});
    message.channel.send(`No pude reproducir esa canción: ${err.message}`);
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciéndose.');
  }
  await queue.player.setPaused(true);
  queue.playing = false;
  message.channel.send('Canción pausada.');
}

async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player) return message.channel.send('No hay nada pausado.');
  await queue.player.setPaused(false);
  queue.playing = true;
  message.channel.send('Canción reanudada.');
}

async function stop(client, message) {
  const queue = client.musicQueues.get(message.guild.id);
  if (!queue?.player) return message.channel.send('No hay nada reproduciéndose.');
  queue.tracks = [];
  await destroyQueue(client, message.guild.id);
  message.channel.send('Reproducción detenida.');
}

async function skip(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciéndose.');
  }
  await queue.player.stopTrack();
  message.channel.send('Canción saltada.');
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
    .setTitle('Cola de reproducción')
    .setDescription(list + (queue.tracks.length > 10 ? `\n...y ${queue.tracks.length - 10} más.` : ''))
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

module.exports = { join, play, pause, resume, stop, skip, showQueue };
