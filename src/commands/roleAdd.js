const { EmbedBuilder } = require('discord.js');

// ,role add <nombre del rol> @usuario
async function roleAdd(client, message, content) {
  if (!message.member.permissions.has('ManageRoles')) {
    return message.channel.send('No tienes permisos para gestionar roles.');
  }
  if (!message.guild.members.me.permissions.has('ManageRoles')) {
    return message.channel.send('No tengo permisos para gestionar roles.');
  }

  const target = message.mentions.members.first();
  if (!target) return message.channel.send('Menciona un usuario. Uso: `,role add <nombre del rol> @usuario`');

  // content = "role add <rolename> @mention"
  // Remove "role add " prefix
  const afterCmd = content.replace(/^role add\s+/i, '');

  // Remove the mention from the string to get the role name
  const mentionRegex = /<@!?(\d+)>/g;
  const roleName = afterCmd.replace(mentionRegex, '').trim();

  if (!roleName) {
    return message.channel.send('Especifica el nombre del rol. Uso: `,role add <nombre del rol> @usuario`');
  }

  // Find role by name (case-insensitive)
  const role = message.guild.roles.cache.find(
    r => r.name.toLowerCase() === roleName.toLowerCase()
  );

  if (!role) {
    return message.channel.send(`No encontré un rol llamado **${roleName}**.`);
  }

  if (role.position >= message.guild.members.me.roles.highest.position) {
    return message.channel.send('Ese rol está por encima de mi rol más alto, no puedo asignarlo.');
  }

  try {
    await target.roles.add(role);

    const embed = new EmbedBuilder()
      .setColor(role.color || 0x5865f2)
      .setTitle('✅ Rol añadido')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag}`, inline: true },
        { name: 'Rol', value: role.name, inline: true },
        { name: 'Por', value: message.author.tag, inline: true }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('❌ No pude añadir el rol.');
  }
}

module.exports = roleAdd;
