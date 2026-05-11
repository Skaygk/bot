const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const playdl = require('play-dl');
const { EmbedBuilder } = require('discord.js');

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

async function join(client, message) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('Debes estar en un canal de voz.');

  const queue = getQueue(client, message.guild.id);

  if (queue.connection) {
    return message.channel.send('Ya estoy en un canal de voz.');
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
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('Debes estar en un vc');

  const query = content.replace(/^play\s+/i, '').trim();
  if (!query) return message.channel.send('Especifica una canción. asi: `,play <nombre o URL>`');

  const queue = getQueue(client, message.guild.id);

  if (!queue.connection) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    queue.connection = connection;
  }

  try {
    let url;
    let songTitle;

    const urlCheck = await playdl.validate(query);

    if (urlCheck && urlCheck !== 'search') {
      const info = await playdl.video_info(query);
      url = query;
      songTitle = info.video_details.title;
    } else {
      const results = await playdl.search(query, { limit: 1 });
      if (!results || results.length === 0) {
        return message.channel.send('ulu no encontro esa cancion');
      }
      url = results[0].url;
      songTitle = results[0].title;
    }

    const stream = await playdl.stream(url, { quality: 2 });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    if (!queue.player) {
      queue.player = createAudioPlayer();
      queue.connection.subscribe(queue.player);
    }

    queue.player.play(resource);
    queue.playing = true;

    queue.player.removeAllListeners(AudioPlayerStatus.Idle);
    queue.player.removeAllListeners('error');

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
    console.error('Play error:', err);
    message.channel.send('No pude reproducir esa canción. Intenta con otro link o nombre.');
  }
}

async function pause(client, message) {
  const queue = getQueue(client, message.guild.id);
  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing) {
    return message.channel.send('no hay nada reproduciéndose.');
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
  message.channel.send('continuando.');
}

module.exports = { join, play, pause, resume };
