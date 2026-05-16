/**
 * music.js — Módulo de música con Lavalink + Shoukaku v4
 */

const { EmbedBuilder } = require('discord.js');

// ─── Timers ───────────────────────────────────────────────────────────────────
const inactivityTimers   = new Map();
const emptyChannelTimers = new Map();

// ─── Queue helpers ────────────────────────────────────────────────────────────
function getQueue(client, guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      player:       null,
      tracks:       [],
      playing:      false,
      volume:       100,
      currentTrack: null,
      requestedBy:  null,
      textChannel:  null,
    });
  }
  return client.musicQueues.get(guildId);
}

function getAllNodes(client) {
  const ideal = client.shoukaku.getIdealNode();
  const all   = [...client.shoukaku.nodes.values()];
  if (!all.length) throw new Error('No hay nodos Lavalink registrados.');
  if (!ideal) return all;
  return [ideal, ...all.filter(n => n !== ideal)];
}

// ─── Formato duración ─────────────────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms) return '?:??';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Detectores de URL ────────────────────────────────────────────────────────
function isYouTubeUrl(q) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(q);
}
function isAnyUrl(q) {
  return /^https?:\/\//i.test(q);
}

// ─── Extraer primer track de resultado Lavalink ───────────────────────────────
function extractTrack(result) {
  if (!result?.data) return null;
  const { loadType } = result;
  if (loadType === 'error' || loadType === 'empty') return null;
  if (loadType === 'search')   return result.data[0]          ?? null;
  if (loadType === 'track')    return result.data              ?? null;
  if (loadType === 'playlist') return result.data.tracks?.[0] ?? null;
  return null;
}

// ─── Buscar track probando todos los nodos disponibles ───────────────────────
async function searchTrack(client, query) {
  const nodes      = getAllNodes(client);
  console.log(`[searchTrack] Nodos disponibles: ${nodes.map(n => n.name).join(', ')}`);
  const ytUrl      = isYouTubeUrl(query);
  const genericUrl = !ytUrl && isAnyUrl(query);

  const sources = ytUrl || genericUrl
    ? [query, ...(ytUrl ? [`ytsearch:${query}`] : [])]
    : [`ytmsearch:${query}`, `ytsearch:${query}`, `spsearch:${query}`];

  for (const node of nodes) {
    for (const src of sources) {
      const r = await node.rest.resolve(src).catch(() => null);
      const t = r ? extractTrack(r) : null;
      if (t) {
        console.log(`[searchTrack] Encontrado en nodo "${node.name}" con fuente: ${src}`);
        t._sourceNode  = node.name;
        t._sourceQuery = query;
        return t;
      }
    }
  }

  throw new Error(ytUrl || genericUrl
    ? 'No se pudo cargar ese link en ningun nodo disponible.'
    : 'No se encontro ningun resultado para esa busqueda.'
  );
}

// ─── Timers ───────────────────────────────────────────────────────────────────
function clearInactivityTimer(guildId) {
  if (inactivityTimers.has(guildId)) {
    clearTimeout(inactivityTimers.get(guildId));
    inactivityTimers.delete(guildId);
  }
}

function clearEmptyChannelTimer(guildId) {
  if (emptyChannelTimers.has(guildId)) {
    clearTimeout(emptyChannelTimers.get(guildId));
    emptyChannelTimers.delete(guildId);
  }
}

function startInactivityTimer(client, guildId) {
  clearInactivityTimer(guildId);
  const timer = setTimeout(async () => {
    const queue = client.musicQueues.get(guildId);
    if (!queue || queue.playing) return;
    queue.textChannel?.send('Sin actividad durante 5 minutos. Saliendo del canal.').catch(() => {});
    await destroyQueue(client, guildId);
  }, 5 * 60 * 1000);
  inactivityTimers.set(guildId, timer);
}

// ─── Destruir queue y desconectar ────────────────────────────────────────────
// FIX: separar "detener player" de "limpiar estado local" para no
//      llamar a leaveVoiceChannel cuando la sesión ya no existe.
async function destroyQueue(client, guildId) {
  clearInactivityTimer(guildId);
  clearEmptyChannelTimer(guildId);

  const queue = client.musicQueues.get(guildId);

  // Quitar listeners ANTES de stopTrack para evitar que 'end'/'close'
  // dispare playNext o borre la queue mientras la estamos destruyendo.
  if (queue?.player) {
    queue.player.removeAllListeners();
    try { await queue.player.stopTrack(); } catch (_) {}
  }

  // Salir del canal de voz. Si la sesión ya no existe Shoukaku lanzará,
  // pero lo ignoramos: el objetivo es limpiar el estado local.
  try { await client.shoukaku.leaveVoiceChannel(guildId); } catch (_) {}

  client.musicQueues.delete(guildId);
}

// ─── Limpiar cualquier conexión residual de Shoukaku para una guild ───────────
// FIX: también quita listeners del player residual para evitar efectos
//      secundarios si Shoukaku dispara eventos después de leaveVoiceChannel.
async function forceCleanup(client, guildId) {
  clearInactivityTimer(guildId);
  clearEmptyChannelTimer(guildId);

  const queue = client.musicQueues.get(guildId);
  if (queue?.player) {
    queue.player.removeAllListeners();
  }

  client.musicQueues.delete(guildId);

  // Intentar salir del VC. Si ya no hay sesión, Shoukaku lanzará → lo ignoramos.
  try { await client.shoukaku.leaveVoiceChannel(guildId); } catch (_) {}
}

// ─── Reproducir siguiente track ───────────────────────────────────────────────
async function playNext(client, guildId, _retryItem) {
  const queue = client.musicQueues.get(guildId);
  if (!queue) return;

  const item = _retryItem ?? (queue.tracks.length ? queue.tracks.shift() : null);
  if (!item) {
    queue.playing      = false;
    queue.currentTrack = null;
    queue.requestedBy  = null;
    startInactivityTimer(client, guildId);
    return;
  }

  clearInactivityTimer(guildId);

  const title    = item.track.info?.title  ?? 'Desconocido';
  const author   = item.track.info?.author ?? '';
  const uri      = item.track.info?.uri    ?? '';
  const duration = formatDuration(item.track.info?.length ?? 0);

  try {
    console.log(`[playNext] Reproduciendo: ${title}`);
    await queue.player.playTrack({ track: { encoded: item.track.encoded } });
    queue.playing      = true;
    queue.currentTrack = item.track;
    queue.requestedBy  = item.requestedBy;

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('Reproduciendo ahora')
      .setDescription(`**[${title}${author ? ` - ${author}` : ''}](${uri})**`)
      .addFields({ name: 'Duracion', value: duration, inline: true })
      .setTimestamp();

    queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[playNext] Error al reproducir:', err.message);
    queue.playing = false;
    playNext(client, guildId);
  }
}

// ─── Registrar listeners del player ──────────────────────────────────────────
// FIX: extraído a función propia para poder re-registrar después de un
//      reconnect sin duplicar listeners.
function attachPlayerListeners(client, guildId, player) {
  // Limpiar listeners previos por si acaso
  player.removeAllListeners();

  player.on('end', async (data) => {
    const reason = data?.reason ?? '';
    console.log(`[Player] Track terminado en guild ${guildId} reason=${reason}`);
    const q = client.musicQueues.get(guildId);
    if (!q) return;
    q.playing = false;
    if (reason === 'replaced') return;

    if (reason === 'loadFailed') {
      const failedTrack = q.currentTrack;
      const query       = failedTrack?._sourceQuery ?? failedTrack?.info?.title;
      console.warn(`[Player] loadFailed en "${failedTrack?.info?.title}", re-buscando con query: ${query}`);

      if (query) {
        try {
          const freshTrack = await searchTrack(client, query);
          if (freshTrack.encoded !== failedTrack.encoded) {
            console.log('[Player] Re-búsqueda exitosa, reproduciendo con nuevo encoded');
            playNext(client, guildId, { track: freshTrack, requestedBy: q.requestedBy });
            return;
          }
        } catch (e) {
          console.error(`[Player] Re-búsqueda fallida: ${e.message}`);
        }
      }
      q.textChannel?.send(
        `No se pudo reproducir: **${failedTrack?.info?.title ?? 'track desconocido'}** (fallo de carga en todos los nodos). Pasando al siguiente.`
      ).catch(() => {});
    }

    playNext(client, guildId);
  });

  player.on('error', (err) => {
    console.error(`[Player] Error en guild ${guildId}:`, err?.message ?? err);
    const q = client.musicQueues.get(guildId);
    if (!q) return;
    q.playing = false;
    q.textChannel?.send(`Error en el reproductor: ${err?.message ?? err}`).catch(() => {});
    playNext(client, guildId);
  });

  // FIX: en 'close' NO borramos la queue directamente porque puede dispararse
  //      durante un leaveVoiceChannel legítimo que ya está manejando destroyQueue.
  //      Solo limpiamos timers y marcamos el player como null si la queue existe.
  player.on('close', () => {
    console.log(`[Player] Cerrado en guild ${guildId}`);
    clearInactivityTimer(guildId);
    clearEmptyChannelTimer(guildId);
    const q = client.musicQueues.get(guildId);
    if (q) {
      q.player  = null;
      q.playing = false;
    }
  });

  player.on('stuck', () => {
    console.warn(`[Player] Track stuck en guild ${guildId}, saltando...`);
    playNext(client, guildId);
  });
}

// ─── Crear player ─────────────────────────────────────────────────────────────
async function createPlayer(client, guildId, voiceChannelId, shardId, textChannel) {
  const queue = getQueue(client, guildId);
  queue.textChannel = textChannel;

  console.log(`[createPlayer] Conectando a canal ${voiceChannelId} en guild ${guildId}`);

  const player = await client.shoukaku.joinVoiceChannel({
    guildId,
    channelId: voiceChannelId,
    shardId:   shardId ?? 0,
    deaf:      true,
  });

  queue.player = player;
  attachPlayerListeners(client, guildId, player);

  console.log(`[createPlayer] Player listo en guild ${guildId}`);
  return player;
}

// ─── voiceStateUpdate: canal vacío → salir en 1 min ──────────────────────────
function handleVoiceStateUpdate(client, oldState, newState) {
  const guildId = oldState.guild?.id ?? newState.guild?.id;
  if (!guildId) return;

  const queue = client.musicQueues.get(guildId);
  if (!queue?.player) return;

  const botChannelId = oldState.guild.members.me?.voice?.channelId;
  if (!botChannelId) return;

  const botChannel = oldState.guild.channels.cache.get(botChannelId);
  if (!botChannel) return;

  const humans = botChannel.members.filter(m => !m.user.bot).size;

  if (humans === 0) {
    if (!emptyChannelTimers.has(guildId)) {
      const timer = setTimeout(async () => {
        emptyChannelTimers.delete(guildId);
        const q = client.musicQueues.get(guildId);
        if (q?.player) {
          q.textChannel?.send('Canal de voz vacio. Saliendo.').catch(() => {});
          await destroyQueue(client, guildId);
        }
      }, 60 * 1000);
      emptyChannelTimers.set(guildId, timer);
    }
  } else {
    clearEmptyChannelTimer(guildId);
  }
}

// ─── Comandos ─────────────────────────────────────────────────────────────────

async function join(client, message) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const queue = client.musicQueues.get(message.guild.id);

  if (queue?.player) {
    try {
      message.guild.shard.send({
        op: 4,
        d: { guild_id: message.guild.id, channel_id: voiceChannel.id, self_mute: false, self_deaf: true },
      });
      queue.textChannel = message.channel;
      return message.channel.send(`Me movi a **${voiceChannel.name}**.`);
    } catch (err) {
      console.error('[join] Error al mover:', err.message);
      return message.channel.send(`No pude moverme: ${err.message}`);
    }
  }

  try {
    // FIX: forceCleanup ya no llama leaveVoiceChannel si no hay player activo,
    //      así que no rompe la sesión antes de joinVoiceChannel.
    await forceCleanup(client, message.guild.id);
    await createPlayer(client, message.guild.id, voiceChannel.id, message.guild.shardId, message.channel);
    message.channel.send(`Me uni a **${voiceChannel.name}**.`);
  } catch (err) {
    console.error('[join] Error:', err.message);
    await forceCleanup(client, message.guild.id);
    message.channel.send(`No pude unirme: ${err.message}`);
  }
}

async function play(client, message, content) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Especifica una cancion. Uso: `,play <nombre o URL>`');

  let queue = client.musicQueues.get(message.guild.id);

  // FIX: si el player existe pero 'close' ya lo anuló (queue.player === null),
  //      tratar como si no hubiera player → limpiar y reconectar.
  if (!queue?.player) {
    await forceCleanup(client, message.guild.id);
    try {
      await createPlayer(client, message.guild.id, voiceChannel.id, message.guild.shardId, message.channel);
      queue = client.musicQueues.get(message.guild.id);
    } catch (err) {
      console.error('[play] Error al unirse:', err.message);
      await forceCleanup(client, message.guild.id);
      return message.channel.send(`No pude unirme al canal: ${err.message}`);
    }
  } else {
    const botInVc = message.guild.members.me?.voice?.channelId;
    if (!botInVc) {
      console.warn('[play] Queue existe pero bot no esta en VC, limpiando y reconectando...');
      await forceCleanup(client, message.guild.id);
      try {
        await createPlayer(client, message.guild.id, voiceChannel.id, message.guild.shardId, message.channel);
        queue = client.musicQueues.get(message.guild.id);
      } catch (err) {
        console.error('[play] Error al reconectar:', err.message);
        await forceCleanup(client, message.guild.id);
        return message.channel.send(`No pude unirme al canal: ${err.message}`);
      }
    } else {
      queue.textChannel = message.channel;
    }
  }

  const loadingMsg = await message.channel.send('Buscando cancion...');

  try {
    const track = await searchTrack(client, query);

    console.log(`[play] Track encontrado: ${track.info?.title}`);

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
          { name: 'Duracion',         value: duration,                  inline: true },
          { name: 'Posicion en cola', value: `#${queue.tracks.length}`, inline: true },
        )
        .setFooter({ text: `Solicitado por ${message.author.tag}` })
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    } else {
      await playNext(client, message.guild.id);
    }
  } catch (err) {
    console.error('[play] Error:', err.message);
    await loadingMsg.delete().catch(() => {});
    message.channel.send(`No pude reproducir esa cancion: ${err.message}`);
  }
}

async function pause(client, message) {
  const queue = client.musicQueues.get(message.guild.id);
  console.log('[pause] Estado queue:', queue ? `player=${!!queue.player} playing=${queue.playing}` : 'null');
  if (!queue?.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciendose.');
  }
  await queue.player.setPaused(true);
  queue.playing = false;
  message.channel.send('Cancion pausada.');
}

async function resume(client, message) {
  const queue = client.musicQueues.get(message.guild.id);
  if (!queue?.player) {
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
  const queue = client.musicQueues.get(message.guild.id);
  if (!queue?.player || !queue.playing) {
    return message.channel.send('No hay nada reproduciendose.');
  }

  const botChannelId = message.guild.members.me?.voice?.channelId;
  const botChannel   = botChannelId ? message.guild.channels.cache.get(botChannelId) : null;
  const humanMembers = botChannel?.members.filter(m => !m.user.bot);
  const humanCount   = humanMembers?.size ?? 1;

  if (queue.requestedBy === message.author.id || humanCount <= 1) {
    await queue.player.stopTrack();
    return message.channel.send('Cancion saltada.');
  }

  const votesNeeded = Math.ceil(humanCount / 2);
  const voters      = new Set([message.author.id]);

  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle('Votacion para saltar cancion')
    .setDescription(
      `**${message.author.tag}** quiere saltar la cancion actual.\n\n` +
      `Reacciona con ✅ para votar a favor.\n` +
      `Votos necesarios: **${votesNeeded}** de **${humanCount}**\n` +
      `Tiempo: 60 segundos`
    )
    .setTimestamp();

  const voteMsg = await message.channel.send({ embeds: [embed] });
  await voteMsg.react('✅').catch(() => {});

  const collector = voteMsg.createReactionCollector({
    filter: (r, u) => r.emoji.name === '✅' && !u.bot && humanMembers?.has(u.id),
    time: 60_000,
  });

  collector.on('collect', (_, user) => {
    voters.add(user.id);
    if (voters.size >= votesNeeded) collector.stop('passed');
  });

  collector.on('end', async (_, reason) => {
    await voteMsg.delete().catch(() => {});
    const q = client.musicQueues.get(message.guild.id);
    if (reason === 'passed' && q?.player && q.playing) {
      await q.player.stopTrack();
      message.channel.send(`Votacion aprobada (${voters.size}/${humanCount}). Cancion saltada.`);
    } else if (reason !== 'passed') {
      message.channel.send(`Votacion terminada. No se alcanzaron los votos (${voters.size}/${votesNeeded}).`);
    }
  });
}

function showQueue(client, message) {
  const queue = client.musicQueues.get(message.guild.id);

  const current = queue?.currentTrack;
  const tracks  = queue?.tracks ?? [];

  if (!current && !tracks.length) {
    return message.channel.send('La cola esta vacia y no hay nada reproduciendose.');
  }

  let description = '';

  if (current) {
    const title  = current.info?.title  ?? 'Desconocido';
    const author = current.info?.author ?? '';
    const dur    = formatDuration(current.info?.length ?? 0);
    description += `**Reproduciendo ahora:**\n${title}${author ? ` - ${author}` : ''} \`[${dur}]\`\n\n`;
  }

  if (tracks.length) {
    description += '**Siguiente en cola:**\n';
    description += tracks.slice(0, 10).map((item, i) => {
      const t   = item.track ?? item;
      const ttl = t.info?.title ?? 'Desconocido';
      const dur = formatDuration(t.info?.length ?? 0);
      return `**${i + 1}.** ${ttl} \`[${dur}]\``;
    }).join('\n');
    if (tracks.length > 10) description += `\n...y ${tracks.length - 10} canciones mas.`;
  } else {
    description += '_No hay canciones en cola._';
  }

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('Cola de reproduccion')
    .setDescription(description)
    .setFooter({ text: `Total en cola: ${tracks.length} cancion(es)` })
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

module.exports = { join, play, pause, resume, stop, skip, showQueue, handleVoiceStateUpdate };
