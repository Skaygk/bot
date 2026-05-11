const nuke       = require('./commands/nuke');
const forcename  = require('./commands/forcename');
const ban        = require('./commands/ban');
const unban      = require('./commands/unban');
const mute       = require('./commands/mute');
const unmute     = require('./commands/unmute');
const avatar     = require('./commands/avatar');
const roleAdd    = require('./commands/roleAdd');
const kick       = require('./commands/kick');
const music      = require('./commands/music');

async function handleCommand(client, message) {
  const content = message.content.slice(1).trim(); // remove ","
  const lower   = content.toLowerCase();

  try {
    if (lower === 'nuke') return await nuke(client, message);

    if (lower.startsWith('fn ') || lower.startsWith('forcename ')) {
      return await forcename(client, message, content);
    }

    if (lower.startsWith('ban '))    return await ban(client, message, content);
    if (lower.startsWith('unban '))  return await unban(client, message, content);
    if (lower.startsWith('mute '))   return await mute(client, message, content);
    if (lower.startsWith('unmute ')) return await unmute(client, message, content);
    if (lower.startsWith('avatar'))  return await avatar(client, message, content);
    if (lower.startsWith('role add ')) return await roleAdd(client, message, content);
    if (lower.startsWith('kick '))   return await kick(client, message, content);

    // Music
    if (lower === 'join')                          return await music.join(client, message);
    if (lower.startsWith('play '))                 return await music.play(client, message, content);
    if (lower === 'pause')                         return await music.pause(client, message);
    if (lower === 'resume' || lower === 'r')       return await music.resume(client, message);
    if (lower === 'stop')                          return await music.stop(client, message);
    if (lower === 'skip' || lower === 's')         return await music.skip(client, message);
    if (lower === 'queue' || lower === 'q')        return await music.showQueue(client, message);

  } catch (err) {
    console.error('Error en comando:', err);
    message.channel.send('Ocurrio un error al ejecutar el comando.').catch(() => {});
  }
}

module.exports = { handleCommand };
