const { EmbedBuilder } = require('discord.js');

// ,unban <userId>
async function unban(client, message, content) {
  if (!message.member.permissions.has('BanMembers')) {
    return message.channel.send('No tienes permisos para desbanear.');
  }
  if (!message.guild.members.me.permissions.has('BanMembers')) {
    return message.channel.send('No tengo permisos para desbanear.');
  }

  const args = content.split(' ');
  const userId = args[1]?.trim();

  if (!userId) return message.channel.send('Proporciona el ID del usuario. Uso: `,unban <ID>`');

  try {
    const bannedUser = await message.guild.bans.fetch(userId);
    await message.guild.members.unban(userId);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Usuario desbaneado')
      .addFields(
        { name: 'Usuario', value: `${bannedUser.user.tag} (${userId})`, inline: true },
        { name: 'Por', value: message.author.tag, inline: true }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('No encontré ese ban o no pude desbanear al usuario.');
  }
}

module.exports = unban;
