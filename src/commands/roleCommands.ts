import type { Store } from "../store/types";

export async function handleCreateRole(store: Store, chatId: number, name: string): Promise<string> {
  const existing = await store.findRole(chatId, name);
  if (existing) {
    return `Role "${name}" already exists.`;
  }
  await store.createRole(chatId, name);
  return `Role "${name}" created.`;
}

export async function handleDeleteRole(store: Store, chatId: number, name: string): Promise<string> {
  const existing = await store.findRole(chatId, name);
  if (!existing) {
    return `Role "${name}" does not exist.`;
  }
  await store.deleteRole(chatId, name);
  return `Role "${name}" deleted.`;
}

export async function handleListRoles(store: Store, chatId: number): Promise<string> {
  const roles = await store.listRoles(chatId);
  if (roles.length === 0) {
    return "No roles have been created yet.";
  }

  const lines = await Promise.all(
    roles.map(async (role) => {
      const members = await store.getRoleMembers(role.id);
      const label = members.length === 1 ? "member" : "members";
      return `${role.name} (${members.length} ${label})`;
    }),
  );

  return lines.join("\n");
}
