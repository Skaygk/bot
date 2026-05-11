const { EmbedBuilder, PermissionsBitField } = require('discord.js');

// ,mute @user
async function mute(client, message, content) {
  if (!message.member.permissions.has('ManageRoles')) {
    return message.channel.send('No tienes permisos para mutear.');
  }

  const target = message.mentions.members.first();
  if (!target) return message.channel.send('Menciona un usuario. Uso: `,mute @usuario`');

  // Find or create "Muted" role
  let muteRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');

  if (!muteRole) {
    // Create the mute role
    muteRole = await message.guild.roles.create({
      name: 'Muted',
      color: 0x808080,
      permissions: [],
      reason: 'Auto-created for mute command',
    });

    // Deny SendMessages in all text channels
    for (const [, channel] of message.guild.channels.cache) {
      try {
        await channel.permissionOverwrites.create(muteRole, {
          SendMessages: false,
          AddReactions: false,
          Speak: false,
        });
      } catch (_) {}
    }
  }

  if (target.roles.cache.has(muteRole.id)) {
    return message.channel.send('Ese usuario ya está muteado.');
  }

  try {
    await target.roles.add(muteRole, 'Mute command');

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle('🔇 Usuario muteado')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Por', value: message.author.tag, inline: true }
      )
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  } catch (err) {
    message.channel.send('No pude mutear a ese usuario.');
  }
}

module.exports = mute;
