const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const { Readable } = require('stream');

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

function searchAndGetUrl(query) {
  return new Promise((resolve, reject) => {
    const isUrl = query.startsWith('http');
    const target = isUrl ? query : `ytsearch1:${query}`;
    const cmd = `yt-dlp -f bestaudio --get-url --get-title "${target}"`;
    exec(cmd, (err, stdout) => {
      if (err) return reject(err);
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length < 2) return reject(new Error('No results'));
      const title = lines[0];
      const url = lines[lines.length - 1];
      resolve({ title, url });
    });
  });
}

function getStream(url) {
  return new Promise((resolve, reject) => {
    const ffmpegStatic = require('ffmpeg-static');
    const { spawn } = require('child_process');
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
      'pipe:1'
    ];
    const process = spawn(ffmpegStatic, args);
    resolve(process.stdout);
  });
}

async function join(client, message) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) return message.channel.send('No estas en un canal de voz.');

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

  message.channel.send(`Me uni a **${voiceChannel.name}**.`);
}

async function play(client, message, content) {
  const voiceChannel = message.member.voice.channel;
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
  }

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
      .setTitle('Reproduciendo')
      .setDescription(`**${title}**`)
      .setFooter({ text: `Solicitado por ${message.author.tag}` })
      .setTimestamp();

    message.channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('Play error:', err);
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

module.exports = { join, play, pause, resume };
