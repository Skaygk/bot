const { EmbedBuilder } = require('discord.js');

// ,ban @user [razon]
async function ban(client, message, content) {
  if (!message.member.permissions.has('BanMembers')) {
    return message.channel.send(' No tienes permisos para banear.');
  }
  if (!message.guild.members.me.permissions.has('BanMembers')) {
    return message.channel.send('No tengo permisos para banear.');
  }

  const target = message.mentions.members.first();
  if (!target) return message.channel.send(' Menciona un usuario. Uso: `,ban @usuario [razón]`');

  const args = content.split(' ').slice(1);
  const reason = args.slice(1).join(' ') || 'Sin razón especificada';

  try {
    await target.ban({ reason });

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🔨 Usuario baneado')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Por', value: message.author.tag, inline: true },
        { name: 'Razón', value: reason }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('No pude banear a ese usuario.');
  }
}

module.exports = ban;
