/**
 * music.js — Módulo de música con Lavalink + Shoukaku
 * Requiere que client.shoukaku esté inicializado en index.js
 */

const { EmbedBuilder } = require('discord.js');

// ─── Timers de inactividad por servidor ──────────────────────────────────────
const inactivityTimers = new Map(); // guildId -> Timeout (sin música 5 min)
const emptyChannelTimers = new Map(); // guildId -> Timeout (VC vacío 1 min)

// ─── Helper: obtener/crear cola por servidor ─────────────────────────────────
function getQueue(client, guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      player:       null,
      tracks:       [],
      playing:      false,
      volume:       100,
      currentTrack: null,
      requestedBy:  null,  // userId del que pidio la cancion actual
      textChannel:  null,  // canal de texto donde enviar mensajes
    });
  }
  return client.musicQueues.get(guildId);
}

// ─── Helper: obtener nodo Lavalink disponible ─────────────────────────────────
function getNode(client) {
  const node = client.shoukaku.getIdealNode();
  if (!node) throw new Error('No hay nodos Lavalink disponibles en este momento.');
  return node;
}

// ─── Helper: detectar tipo de URL ────────────────────────────────────────────
function isYouTubeUrl(query) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(query);
}

function isAnyUrl(query) {
  return /^https?:\/\//i.test(query);
}

// ─── Helper: extraer primer track de un resultado ────────────────────────────
function extractTrack(result) {
  if (!result || !result.data) return null;
  const { loadType } = result;
  if (loadType === 'error' || loadType === 'empty') return null;
  if (loadType === 'search')   return result.data[0]          ?? null;
  if (loadType === 'track')    return result.data              ?? null;
  if (loadType === 'playlist') return result.data.tracks?.[0] ?? null;
  return null;
}

// ─── Helper: buscar track en Lavalink ────────────────────────────────────────
// Orden de intentos:
//   URL de YouTube → directo (el nodo lo resuelve si tiene el plugin)
//   URL generica   → directo
//   Texto          → ytmsearch → ytsearch → spsearch → error
async function searchTrack(node, query) {
  const ytUrl      = isYouTubeUrl(query);
  const genericUrl = !ytUrl && isAnyUrl(query);

  // Caso 1: URL de YouTube u otra URL directa
  if (ytUrl || genericUrl) {
    const result = await node.rest.resolve(query);
    const track  = extractTrack(result);
    if (track) return track;

    // Si el nodo rechazo la URL de YouTube, intentar como busqueda de texto
    if (ytUrl) {
      const retry = await node.rest.resolve(`ytsearch:${query}`).catch(() => null);
      const t2    = retry ? extractTrack(retry) : null;
      if (t2) return t2;
    }

    throw new Error('No se pudo cargar ese link. El nodo puede no soportar ese tipo de URL.');
  }

  // Caso 2: busqueda por texto con multiples fuentes como fallback
  const r1 = await node.rest.resolve(`ytmsearch:${query}`).catch(() => null);
  const t1 = r1 ? extractTrack(r1) : null;
  if (t1) return t1;

  const r2 = await node.rest.resolve(`ytsearch:${query}`).catch(() => null);
  const t2 = r2 ? extractTrack(r2) : null;
  if (t2) return t2;

  const r3 = await node.rest.resolve(`spsearch:${query}`).catch(() => null);
  const t3 = r3 ? extractTrack(r3) : null;
  if (t3) return t3;

  throw new Error('No se encontro ningun resultado para esa busqueda.');
}

// ─── Helper: formatear duración ms → mm:ss ───────────────────────────────────
function formatDuration(ms) {
  if (!ms) return '?:??';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

// ─── Helper: limpiar timer de inactividad ────────────────────────────────────
function clearInactivityTimer(guildId) {
  if (inactivityTimers.has(guildId)) {
    clearTimeout(inactivityTimers.get(guildId));
    inactivityTimers.delete(guildId);
  }
}

// ─── Helper: limpiar timer de canal vacío ────────────────────────────────────
function clearEmptyChannelTimer(guildId) {
  if (emptyChannelTimers.has(guildId)) {
    clearTimeout(emptyChannelTimers.get(guildId));
    emptyChannelTimers.delete(guildId);
  }
}

// ─── Helper: iniciar timer de inactividad (5 min sin música → salir) ─────────
function startInactivityTimer(client, guildId, textChannel) {
  clearInactivityTimer(guildId);
  const timer = setTimeout(async () => {
    const queue = client.musicQueues.get(guildId);
    if (queue && !queue.playing) {
      textChannel.send('Sin actividad durante 5 minutos. Saliendo del canal de voz.').catch(() => {});
      await destroyQueue(client, guildId);
    }
  }, 5 * 60 * 1000);
  inactivityTimers.set(guildId, timer);
}

// ─── Helper: reproducir siguiente track en cola ──────────────────────────────
async function playNext(client, guildId, textChannel) {
  const queue = getQueue(client, guildId);

  if (!queue.tracks.length) {
    queue.playing = false;
    queue.currentTrack = null;
    queue.requestedBy = null;
    startInactivityTimer(client, guildId, textChannel);
    return;
  }

  const item = queue.tracks.shift(); // { track, requestedBy }

  try {
    await queue.player.playTrack({ track: { encoded: item.track.encoded } });
    queue.playing = true;
    queue.currentTrack = item.track;
    queue.requestedBy = item.requestedBy;

    clearInactivityTimer(guildId);

    const title    = item.track.info?.title  ?? 'Desconocido';
    const author   = item.track.info?.author ?? '';
    const uri      = item.track.info?.uri    ?? '';
    const duration = formatDuration(item.track.info?.length ?? 0);

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('Reproduciendo ahora')
      .setDescription(`**[${title}${author ? ` - ${author}` : ''}](${uri})**`)
      .addFields({ name: 'Duracion', value: duration, inline: true })
      .setTimestamp();

    textChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[playNext] Error:', err.message);
    queue.playing = false;
    playNext(client, guildId, textChannel);
  }
}

// ─── Helper: crear player y adjuntar eventos ─────────────────────────────────
async function createPlayer(client, message, voiceChannel) {
  const guildId = message.guild.id;
  const queue   = getQueue(client, guildId);

  // Guardar el canal de texto para usarlo en eventos asincrónicos
  queue.textChannel = message.channel;

  // Shoukaku v4: joinVoiceChannel esta en client.shoukaku, no en el nodo
  const player = await client.shoukaku.joinVoiceChannel({
    guildId:   guildId,
    channelId: voiceChannel.id,
    shardId:   message.guild.shardId ?? 0,
    deaf:      true,
  });

  queue.player = player;

  player.on('end', () => {
    const q = client.musicQueues.get(guildId);
    if (q?.textChannel) playNext(client, guildId, q.textChannel);
  });

  player.on('error', (err) => {
    console.error('[Lavalink Player] Error:', err.message);
    const q = client.musicQueues.get(guildId);
    if (q?.textChannel) {
      q.textChannel.send(`Error en el reproductor: ${err.message}`).catch(() => {});
      playNext(client, guildId, q.textChannel);
    }
  });

  player.on('close', () => {
    clearInactivityTimer(guildId);
    clearEmptyChannelTimer(guildId);
    client.musicQueues.delete(guildId);
  });

  return player;
}

// ─── Helper: destruir queue y desconectar ────────────────────────────────────
async function destroyQueue(client, guildId) {
  clearInactivityTimer(guildId);
  clearEmptyChannelTimer(guildId);

  const queue = client.musicQueues.get(guildId);
  if (!queue) return;

  if (queue.player) {
    try { await queue.player.stopTrack(); } catch (_) {}
    // Shoukaku v4: leaveVoiceChannel en el manager
    try { await client.shoukaku.leaveVoiceChannel(guildId); } catch (_) {}
  }
  client.musicQueues.delete(guildId);
}

// ─── Handler: canal de voz vacío → salir en 1 minuto ─────────────────────────
function handleVoiceStateUpdate(client, oldState, newState) {
  // Solo nos importan cambios en servidores donde el bot está activo
  const guildId = oldState.guild?.id ?? newState.guild?.id;
  if (!guildId) return;

  const queue = client.musicQueues.get(guildId);
  if (!queue?.player) return;

  // Obtener el canal donde está el bot
  const botVoiceChannelId = oldState.guild.members.me?.voice?.channelId;
  if (!botVoiceChannelId) return;

  const botChannel = oldState.guild.channels.cache.get(botVoiceChannelId);
  if (!botChannel) return;

  // Contar miembros humanos en el canal
  const humans = botChannel.members.filter(m => !m.user.bot).size;

  if (humans === 0) {
    // Canal vacío → timer de 1 minuto
    if (!emptyChannelTimers.has(guildId)) {
      const timer = setTimeout(async () => {
        const q = client.musicQueues.get(guildId);
        if (q?.player) {
          // Intentar enviar mensaje al último canal de texto conocido
          await destroyQueue(client, guildId);
        }
        emptyChannelTimers.delete(guildId);
      }, 60 * 1000);
      emptyChannelTimers.set(guildId, timer);
    }
  } else {
    // Volvió alguien → cancelar timer
    clearEmptyChannelTimer(guildId);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Comandos
// ────────────────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const queue = getQueue(client, message.guild.id);

  if (queue.player) {
    // Mover al nuevo canal usando la API de Discord.js directamente
    try {
      message.guild.shard.send({
        op: 4,
        d: {
          guild_id:   message.guild.id,
          channel_id: voiceChannel.id,
          self_mute:  false,
          self_deaf:  true,
        },
      });
      message.channel.send(`Me movi a **${voiceChannel.name}**.`);
    } catch (err) {
      console.error('[join] Error al mover:', err.message);
      message.channel.send(`No pude moverme: ${err.message}`);
    }
    return;
  }

  try {
    await createPlayer(client, message, voiceChannel);
    message.channel.send(`Me uni a **${voiceChannel.name}**.`);
    startInactivityTimer(client, message.guild.id, message.channel);
  } catch (err) {
    console.error('[join] Error:', err.message);
    message.channel.send(`No pude unirme: ${err.message}`);
  }
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Especifica una cancion. Uso: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  if (!queue.player) {
    try {
      await createPlayer(client, message, voiceChannel);
    } catch (err) {
      console.error('[play] Error al unirse:', err.message);
      return message.channel.send(`No pude unirme al canal: ${err.message}`);
    }
  }

  const loadingMsg = await message.channel.send('Buscando cancion...');

  try {
    const node  = getNode(client);
    const track = await searchTrack(node, query);

    const title    = track.info?.title  ?? 'Desconocido';
    const author   = track.info?.author ?? '';
    const duration = formatDuration(track.info?.length ?? 0);
    const uri      = track.info?.uri    ?? '';

    queue.tracks.push({ track, requestedBy: message.author.id });
    await loadingMsg.delete().catch(() => {});

    if (queue.playing) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Agregado a la cola')
        .setDescription(`**[${title}${author ? ` - ${author}` : ''}](${uri})**`)
        .addFields(
          { name: 'Duracion',          value: duration,                          inline: true },
          { name: 'Posicion en cola',  value: `#${queue.tracks.length}`,         inline: true },
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
    message.channel.send(`No pude reproducir esa cancion: ${err.message}`);
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciendose.');
  }
  await queue.player.setPaused(true);
  queue.playing = false;
  message.channel.send('Cancion pausada.');
}

async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player) {
    return message.channel.send('No hay nada pausado.');
  }
  await queue.player.setPaused(false);
  queue.playing = true;
  message.channel.send('Cancion reanudada.');
}

async function stop(client, message) {
  const queue = client.musicQueues.get(message.guild.id);
  if (!queue?.player) return message.channel.send('No hay nada reproduciendose.');

  queue.tracks = [];
  await destroyQueue(client, message.guild.id);
  message.channel.send('Reproduccion detenida. Salio del canal de voz.');
}

async function skip(client, message) {
  const queue = getQueue(client, message.guild.id);

  if (!queue.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciendose.');
  }

  // Obtener el canal de voz donde está el bot
  const botVoiceChannelId = message.guild.members.me?.voice?.channelId;
  const botChannel = botVoiceChannelId
    ? message.guild.channels.cache.get(botVoiceChannelId)
    : null;

  const humanMembers = botChannel
    ? botChannel.members.filter(m => !m.user.bot)
    : null;

  const humanCount = humanMembers ? humanMembers.size : 1;

  // Si el que pide el skip es quien pidió la canción actual → skip directo
  if (queue.requestedBy === message.author.id || humanCount <= 1) {
    await queue.player.stopTrack();
    message.channel.send('Cancion saltada.');
    return;
  }

  // Votacion: se necesita mayoria simple de los humanos en VC
  const votesNeeded = Math.ceil(humanCount / 2);
  const voters = new Set([message.author.id]);

  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle('Votacion para saltar cancion')
    .setDescription(
      `**${message.author.tag}** quiere saltar la cancion actual.\n\n` +
      `Reacciona con **SI** para votar a favor.\n` +
      `Votos necesarios: **${votesNeeded}** de **${humanCount}**\n` +
      `Tiempo restante: **60 segundos**`
    )
    .setTimestamp();

  const voteMsg = await message.channel.send({ embeds: [embed] });
  await voteMsg.react('✅').catch(() => {});

  const filter = (reaction, user) => {
    return (
      reaction.emoji.name === '✅' &&
      !user.bot &&
      humanMembers.has(user.id)
    );
  };

  const collector = voteMsg.createReactionCollector({ filter, time: 60_000 });

  collector.on('collect', async (reaction, user) => {
    voters.add(user.id);

    if (voters.size >= votesNeeded) {
      collector.stop('passed');
    }
  });

  collector.on('end', async (_, reason) => {
    await voteMsg.delete().catch(() => {});

    if (reason === 'passed') {
      if (queue.player && queue.playing) {
        await queue.player.stopTrack();
        message.channel.send(`Votacion aprobada (${voters.size}/${humanCount}). Cancion saltada.`);
      }
    } else {
      message.channel.send(`Votacion terminada. No se alcanzaron los votos necesarios (${voters.size}/${votesNeeded}).`);
    }
  });
}

function showQueue(client, message) {
  const queue = getQueue(client, message.guild.id);

  const currentTitle  = queue.currentTrack?.info?.title ?? null;
  const currentAuthor = queue.currentTrack?.info?.author ?? '';
  const currentDur    = formatDuration(queue.currentTrack?.info?.length ?? 0);

  if (!queue.playing && !queue.tracks.length) {
    return message.channel.send('La cola esta vacia y no hay nada reproduciendose.');
  }

  let description = '';

  if (currentTitle) {
    description += `**Reproduciendo ahora:**\n${currentTitle}${currentAuthor ? ` - ${currentAuthor}` : ''} \`[${currentDur}]\`\n\n`;
  }

  if (queue.tracks.length) {
    description += '**Siguiente en cola:**\n';
    description += queue.tracks
      .slice(0, 10)
      .map((item, i) => {
        const t   = item.track ?? item; // compatibilidad
        const ttl = t.info?.title ?? 'Desconocido';
        const dur = formatDuration(t.info?.length ?? 0);
        return `**${i + 1}.** ${ttl} \`[${dur}]\``;
      })
      .join('\n');

    if (queue.tracks.length > 10) {
      description += `\n...y ${queue.tracks.length - 10} canciones mas.`;
    }
  } else {
    description += '_No hay canciones en cola._';
  }

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('Cola de reproduccion')
    .setDescription(description)
    .setFooter({ text: `Total en cola: ${queue.tracks.length} cancion(es)` })
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

module.exports = { join, play, pause, resume, stop, skip, showQueue, handleVoiceStateUpdate };
