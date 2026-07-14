import type { Member, Store } from "../store/types";

const NO_TARGET_MESSAGE =
  "Couldn't identify that user. Reply to one of their messages with this command, and make sure they've posted in this group before.";

export async function handleAssign(
  store: Store,
  chatId: number,
  roleName: string,
  target: Member | undefined,
): Promise<string> {
  const role = await store.findRole(chatId, roleName);
  if (!role) {
    return `Role "${roleName}" does not exist.`;
  }
  if (!target) {
    return NO_TARGET_MESSAGE;
  }
  await store.upsertMember(target);
  await store.assignUserToRole(role.id, target.userId);
  return `${target.firstName} added to ${roleName}.`;
}

export async function handleUnassign(
  store: Store,
  chatId: number,
  roleName: string,
  target: Member | undefined,
): Promise<string> {
  const role = await store.findRole(chatId, roleName);
  if (!role) {
    return `Role "${roleName}" does not exist.`;
  }
  if (!target) {
    return NO_TARGET_MESSAGE;
  }
  await store.unassignUserFromRole(role.id, target.userId);
  return `${target.firstName} removed from ${roleName}.`;
}

export async function handleMyRoles(store: Store, chatId: number, userId: number): Promise<string> {
  const roles = await store.getUserRoles(chatId, userId);
  if (roles.length === 0) {
    return "You have no roles in this group.";
  }
  return `Your roles: ${roles.map((r) => r.name).join(", ")}`;
}
