// ,fn @user nombre  OR  ,forcename @user nombre
async function forcename(client, message, content) {
  const guild = message.guild;

  if (!guild.members.me.permissions.has('ManageNicknames')) {
    return message.channel.send('❌ No tengo permisos para cambiar apodos.');
  }

  // Parse: "fn @mention nombre" or "forcename @mention nombre"
  const args = content.split(' ').slice(1); // remove "fn" or "forcename"
  const mention = message.mentions.members.first();

  if (!mention) {
    return message.channel.send('❌ Menciona un usuario. Uso: `,fn @usuario nombre`');
  }

  // Get forced name: everything after the mention
  const mentionStr = args[0]; // the @mention part
  const forcedName = args.slice(1).join(' ').trim();

  if (!forcedName) {
    // If no name given, remove the forced name
    client.forcedNames.delete(mention.id);
    await mention.setNickname(null, 'forcename cleared');
    return message.channel.send(`✅ Se eliminó el nombre forzado de **${mention.user.tag}**.`);
  }

  // Save forced name
  client.forcedNames.set(mention.id, forcedName);

  try {
    await mention.setNickname(forcedName, 'forcename command');
    message.channel.send(`✅ Se forzó el nombre de **${mention.user.tag}** a **${forcedName}**.`);
  } catch (err) {
    message.channel.send('❌ No pude cambiar el apodo (puede ser un administrador o el dueño del server).');
  }
}

module.exports = forcename;
