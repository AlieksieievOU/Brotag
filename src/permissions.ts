export interface ChatMemberApi {
  getChatMember(chatId: number, userId: number): Promise<{ status: string }>;
}

const ADMIN_STATUSES = new Set(["administrator", "creator"]);

export async function isGroupAdmin(api: ChatMemberApi, chatId: number, userId: number): Promise<boolean> {
  const member = await api.getChatMember(chatId, userId);
  return ADMIN_STATUSES.has(member.status);
}
