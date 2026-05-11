const { EmbedBuilder } = require('discord.js');

// ,avatar [@user]
async function avatar(client, message, content) {
  const target = message.mentions.users.first() || message.author;

  const avatarURL = target.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Avatar de ${target.username}`)
    .setImage(avatarURL)
    .setURL(avatarURL)
    .setFooter({ text: `Solicitado por ${message.author.tag}` })
    .setTimestamp();

  message.channel.send({ embeds: [embed] });
}

module.exports = avatar;
