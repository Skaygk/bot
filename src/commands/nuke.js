async function nuke(client, message) {
  const channel = message.channel;
  const guild = message.guild;

  // Check bot permissions
  if (!guild.members.me.permissions.has('ManageChannels')) {
    return message.channel.send('No tengo permisos para los canales');
  }

  // Save everything we need to recreate the channel
  const channelData = {
    name: channel.name,
    type: channel.type,
    topic: channel.topic || undefined,
    nsfw: channel.nsfw,
    bitrate: channel.bitrate || undefined,
    userLimit: channel.userLimit || undefined,
    parent: channel.parentId,
    position: channel.position,
    permissionOverwrites: channel.permissionOverwrites.cache.map(overwrite => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.toArray(),
      deny: overwrite.deny.toArray(),
    })),
    rateLimitPerUser: channel.rateLimitPerUser || 0,
  };

  // Delete the channel
  await channel.delete('Nuke command');

  // Recreate the channel with original permissions
  const newChannel = await guild.channels.create({
    name: channelData.name,
    type: channelData.type,
    topic: channelData.topic,
    nsfw: channelData.nsfw,
    bitrate: channelData.bitrate,
    userLimit: channelData.userLimit,
    parent: channelData.parent,
    position: channelData.position,
    rateLimitPerUser: channelData.rateLimitPerUser,
    permissionOverwrites: channelData.permissionOverwrites,
  });

  // Send confirmation in new channel
  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('💥 Canal nukeado')
    .setDescription('nukesito vro')
    .setTimestamp();

  await newChannel.send({ embeds: [embed] });
}

module.exports = nuke;
