import type { Store } from "../store/types.js";

const VALID_ROLE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const INVALID_NAME_MESSAGE =
  'Role names must start with a letter and contain only letters, digits, or underscores (and can\'t be "all").';

export async function handleCreateRole(store: Store, chatId: number, name: string): Promise<string> {
  if (!VALID_ROLE_NAME.test(name) || name.toLowerCase() === "all") {
    return INVALID_NAME_MESSAGE;
  }
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
