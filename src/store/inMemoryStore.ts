import type { Member, Role, SteamLinkToken, Store } from "./types.js";

function memberKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export class InMemoryStore implements Store {
  private members = new Map<string, Member>();
  private roles = new Map<string, Role>();
  private roleMembers = new Map<string, Set<number>>();
  private nextRoleId = 1;
  private steamLinkTokens = new Map<string, SteamLinkToken>();
  private steamLinks = new Map<string, string>();

  async upsertMember(member: Member): Promise<void> {
    this.members.set(memberKey(member.chatId, member.userId), member);
  }

  async deleteMember(chatId: number, userId: number): Promise<void> {
    this.members.delete(memberKey(chatId, userId));
  }

  async getMembers(chatId: number): Promise<Member[]> {
    return [...this.members.values()].filter((m) => m.chatId === chatId);
  }

  async getMember(chatId: number, userId: number): Promise<Member | undefined> {
    return this.members.get(memberKey(chatId, userId));
  }

  async findMemberByUsername(chatId: number, username: string): Promise<Member | undefined> {
    const target = username.toLowerCase();
    return [...this.members.values()].find(
      (m) => m.chatId === chatId && m.username?.toLowerCase() === target,
    );
  }

  async setBirthday(chatId: number, userId: number, birthday: string): Promise<void> {
    const key = memberKey(chatId, userId);
    const existing = this.members.get(key);
    if (!existing) return;
    this.members.set(key, { ...existing, birthday });
  }

  async createRole(chatId: number, name: string): Promise<Role> {
    const role: Role = { id: String(this.nextRoleId++), chatId, name };
    this.roles.set(role.id, role);
    this.roleMembers.set(role.id, new Set());
    return role;
  }

  async deleteRole(chatId: number, name: string): Promise<void> {
    const role = await this.findRole(chatId, name);
    if (!role) return;
    this.roles.delete(role.id);
    this.roleMembers.delete(role.id);
  }

  async findRole(chatId: number, name: string): Promise<Role | undefined> {
    return [...this.roles.values()].find((r) => r.chatId === chatId && r.name === name);
  }

  async listRoles(chatId: number): Promise<Role[]> {
    return [...this.roles.values()].filter((r) => r.chatId === chatId);
  }

  async assignUserToRole(roleId: string, userId: number): Promise<void> {
    this.roleMembers.get(roleId)?.add(userId);
  }

  async unassignUserFromRole(roleId: string, userId: number): Promise<void> {
    this.roleMembers.get(roleId)?.delete(userId);
  }

  async getRoleMembers(roleId: string): Promise<Member[]> {
    const role = this.roles.get(roleId);
    if (!role) return [];
    const userIds = this.roleMembers.get(roleId) ?? new Set();
    const members = await this.getMembers(role.chatId);
    return members.filter((m) => userIds.has(m.userId));
  }

  async getUserRoles(chatId: number, userId: number): Promise<Role[]> {
    const roles = await this.listRoles(chatId);
    return roles.filter((r) => this.roleMembers.get(r.id)?.has(userId));
  }

  async createSteamLinkToken(record: SteamLinkToken): Promise<void> {
    this.steamLinkTokens.set(record.token, record);
  }

  async getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined> {
    return this.steamLinkTokens.get(token);
  }

  async deleteSteamLinkToken(token: string): Promise<void> {
    this.steamLinkTokens.delete(token);
  }

  async setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void> {
    this.steamLinks.set(memberKey(chatId, userId), steamId64);
  }

  async getSteamLink(chatId: number, userId: number): Promise<string | undefined> {
    return this.steamLinks.get(memberKey(chatId, userId));
  }

  async deleteSteamLink(chatId: number, userId: number): Promise<void> {
    this.steamLinks.delete(memberKey(chatId, userId));
  }
}
