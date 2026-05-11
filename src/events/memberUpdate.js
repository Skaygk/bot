async function handleMemberUpdate(client, oldMember, newMember) {
  // Check if this member has a forced name
  if (!client.forcedNames.has(newMember.id)) return;

  const forcedName = client.forcedNames.get(newMember.id);

  // If nickname changed away from forced name, restore it
  if (newMember.nickname !== forcedName) {
    try {
      await newMember.setNickname(forcedName, 'Restoring forced name');
    } catch (err) {
      // Can't change nickname (owner, higher role, etc.) — silently ignore
      console.log(`Could not restore forced name for ${newMember.user.tag}: ${err.message}`);
    }
  }
}

module.exports = { handleMemberUpdate };
