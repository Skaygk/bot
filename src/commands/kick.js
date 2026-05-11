const { EmbedBuilder } = require('discord.js');

// ,kick @user [razon]
async function kick(client, message, content) {
  if (!message.member.permissions.has('KickMembers')) {
    return message.channel.send('No tienes permisos para kickear.');
  }
  if (!message.guild.members.me.permissions.has('KickMembers')) {
    return message.channel.send('No tengo permisos para kickear.');
  }

  const target = message.mentions.members.first();
  if (!target) return message.channel.send('Menciona un usuario. Uso: `,kick @usuario [razón]`');

  if (!target.kickable) {
    return message.channel.send('No puedo kickear a ese usuario (puede tener un rol más alto que yo).');
  }

  const args = content.split(' ').slice(1);
  const reason = args.slice(1).join(' ') || 'Sin razón especificada';

  try {
    await target.kick(reason);

    const embed = new EmbedBuilder()
      .setColor(0xff8800)
      .setTitle('Usuario kickeado')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Por', value: message.author.tag, inline: true },
        { name: 'Razón', value: reason }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('No pude kickear a ese usuario.');
  }
}

module.exports = kick;
