const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts  = require('yt-search');
const { EmbedBuilder } = require('discord.js');

// Returns or creates a queue entry for this guild
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

// ,join
async function join(client, message) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('❌ Debes estar en un canal de voz.');

  const queue = getQueue(client, message.guild.id);

  if (queue.connection) {
    return message.channel.send('✅ Ya estoy en un canal de voz.');
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

  message.channel.send(`✅ Me uní a **${voiceChannel.name}**.`);
}

// ,play <song name or URL>
async function play(client, message, content) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('❌ Debes estar en un canal de voz.');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('❌ Especifica una canción. Uso: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  // Auto-join if not connected
  if (!queue.connection) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    queue.connection = connection;
  }

  let url = query;
  let songTitle = query;

  // Search by name if not a URL
  if (!ytdl.validateURL(query)) {
    const results = await yts(query);
    const video = results.videos[0];
    if (!video) return message.channel.send('❌ No encontré ninguna canción con ese nombre.');
    url = video.url;
    songTitle = video.title;
  } else {
    try {
      const info = await ytdl.getBasicInfo(url);
      songTitle = info.videoDetails.title;
    } catch (_) {}
  }

  // Create player if needed
  if (!queue.player) {
    queue.player = createAudioPlayer();
    queue.connection.subscribe(queue.player);
  }

  try {
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream);
    queue.player.play(resource);
    queue.playing = true;

    queue.player.on(AudioPlayerStatus.Idle, () => {
      queue.playing = false;
    });

    queue.player.on('error', err => {
      console.error('Music player error:', err);
      queue.playing = false;
    });

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('🎵 Reproduciendo')
      .setDescription(`**${songTitle}**`)
      .setFooter({ text: `Solicitado por ${message.author.tag}` })
      .setTimestamp();

    message.channel.send({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    message.channel.send('❌ No pude reproducir esa canción.');
  }
}

// ,pause
async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || !queue.playing) {
    return message.channel.send('❌ No hay nada reproduciéndose.');
  }
  queue.player.pause();
  message.channel.send('⏸ Música pausada.');
}

// ,resume / ,r
async function resume(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player) {
    return message.channel.send('❌ No hay nada en cola.');
  }
  queue.player.unpause();
  message.channel.send('▶️ Música reanudada.');
}

module.exports = { join, play, pause, resume };
