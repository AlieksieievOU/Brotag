import type { Member } from "../store/types";

export function formatMentions(members: Member[]): string {
  return members.map((m) => `[${m.firstName}](tg://user?id=${m.userId})`).join("\n");
}
