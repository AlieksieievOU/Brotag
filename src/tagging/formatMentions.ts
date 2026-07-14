import type { Member } from "../store/types.js";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatMentions(members: Member[]): string {
  return members
    .map((m) => `<a href="tg://user?id=${m.userId}">${escapeHtml(m.firstName)}</a>`)
    .join("\n");
}
