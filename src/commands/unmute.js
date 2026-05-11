const { EmbedBuilder } = require('discord.js');

// ,unmute @user
async function unmute(client, message, content) {
  if (!message.member.permissions.has('ManageRoles')) {
    return message.channel.send('No tienes permisos para desmutear.');
  }

  const target = message.mentions.members.first();
  if (!target) return message.channel.send('Menciona un usuario. Uso: `,unmute @usuario`');

  const muteRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');

  if (!muteRole || !target.roles.cache.has(muteRole.id)) {
    return message.channel.send('Ese usuario no está muteado.');
  }

  try {
    await target.roles.remove(muteRole, 'Unmute command');

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🔊 Usuario desmuteado')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Por', value: message.author.tag, inline: true }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('No pude desmutear a ese usuario.');
  }
}

module.exports = unmute;
