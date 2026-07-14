import type { Member, Store } from "../store/types";
import { parseTags } from "./parseTags";

export async function resolveTags(text: string, store: Store, chatId: number): Promise<Member[]> {
  const tags = parseTags(text);
  const resolved = new Map<number, Member>();

  for (const tag of tags) {
    const members = tag === "all" ? await store.getMembers(chatId) : await resolveRole(tag, store, chatId);
    for (const member of members) {
      resolved.set(member.userId, member);
    }
  }

  return [...resolved.values()];
}

async function resolveRole(name: string, store: Store, chatId: number): Promise<Member[]> {
  const role = await store.findRole(chatId, name);
  if (!role) return [];
  return store.getRoleMembers(role.id);
}
