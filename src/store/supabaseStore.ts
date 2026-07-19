import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Cs2Tracking, Member, Role, SteamLinkToken, Store } from "./types.js";

export class SupabaseStore implements Store {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey);
  }

  async upsertMember(member: Member): Promise<void> {
    await this.client.from("groups").upsert({ chat_id: member.chatId });
    const { error } = await this.client.from("members").upsert({
      chat_id: member.chatId,
      user_id: member.userId,
      username: member.username ?? null,
      first_name: member.firstName,
    });
    if (error) throw error;
  }

  async deleteMember(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("members")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async getMembers(chatId: number): Promise<Member[]> {
    const { data, error } = await this.client.from("members").select("*").eq("chat_id", chatId);
    if (error) throw error;
    return (data ?? []).map(rowToMember);
  }

  async getMember(chatId: number, userId: number): Promise<Member | undefined> {
    const { data, error } = await this.client
      .from("members")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToMember(data) : undefined;
  }

  async findMemberByUsername(chatId: number, username: string): Promise<Member | undefined> {
    const { data, error } = await this.client
      .from("members")
      .select("*")
      .eq("chat_id", chatId)
      .ilike("username", username)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToMember(data) : undefined;
  }

  async setBirthday(chatId: number, userId: number, birthday: string): Promise<void> {
    const { error } = await this.client
      .from("members")
      .update({ birthday })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async createRole(chatId: number, name: string): Promise<Role> {
    const { data, error } = await this.client
      .from("roles")
      .insert({ chat_id: chatId, name })
      .select()
      .single();
    if (error) throw error;
    return rowToRole(data);
  }

  async deleteRole(chatId: number, name: string): Promise<void> {
    const { error } = await this.client.from("roles").delete().eq("chat_id", chatId).eq("name", name);
    if (error) throw error;
  }

  async findRole(chatId: number, name: string): Promise<Role | undefined> {
    const { data, error } = await this.client
      .from("roles")
      .select("*")
      .eq("chat_id", chatId)
      .eq("name", name)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRole(data) : undefined;
  }

  async listRoles(chatId: number): Promise<Role[]> {
    const { data, error } = await this.client.from("roles").select("*").eq("chat_id", chatId);
    if (error) throw error;
    return (data ?? []).map(rowToRole);
  }

  async assignUserToRole(roleId: string, userId: number): Promise<void> {
    const { error } = await this.client.from("role_members").upsert({ role_id: Number(roleId), user_id: userId });
    if (error) throw error;
  }

  async unassignUserFromRole(roleId: string, userId: number): Promise<void> {
    const { error } = await this.client
      .from("role_members")
      .delete()
      .eq("role_id", Number(roleId))
      .eq("user_id", userId);
    if (error) throw error;
  }

  async getRoleMembers(roleId: string): Promise<Member[]> {
    const { data: role, error: roleError } = await this.client
      .from("roles")
      .select("*")
      .eq("id", Number(roleId))
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) return [];

    const { data: links, error: linksError } = await this.client
      .from("role_members")
      .select("user_id")
      .eq("role_id", Number(roleId));
    if (linksError) throw linksError;

    const userIds = (links ?? []).map((l) => l.user_id);
    if (userIds.length === 0) return [];

    const { data: members, error: membersError } = await this.client
      .from("members")
      .select("*")
      .eq("chat_id", role.chat_id)
      .in("user_id", userIds);
    if (membersError) throw membersError;

    return (members ?? []).map(rowToMember);
  }

  async getUserRoles(chatId: number, userId: number): Promise<Role[]> {
    const { data, error } = await this.client
      .from("role_members")
      .select("role_id, roles!inner(id, chat_id, name)")
      .eq("roles.chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
    return (data ?? []).map((row: any) => rowToRole(row.roles));
  }

  async createSteamLinkToken(record: SteamLinkToken): Promise<void> {
    const { error } = await this.client.from("steam_link_tokens").insert({
      token: record.token,
      chat_id: record.chatId,
      user_id: record.userId,
      expires_at: new Date(record.expiresAt).toISOString(),
    });
    if (error) throw error;
  }

  async getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined> {
    const { data, error } = await this.client
      .from("steam_link_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSteamLinkToken(data) : undefined;
  }

  async deleteSteamLinkToken(token: string): Promise<void> {
    const { error } = await this.client.from("steam_link_tokens").delete().eq("token", token);
    if (error) throw error;
  }

  async setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void> {
    await this.client.from("groups").upsert({ chat_id: chatId });
    const { error } = await this.client.from("steam_links").upsert({
      chat_id: chatId,
      user_id: userId,
      steam_id64: steamId64,
    });
    if (error) throw error;
  }

  async getSteamLink(chatId: number, userId: number): Promise<string | undefined> {
    const { data, error } = await this.client
      .from("steam_links")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.steam_id64 as string) : undefined;
  }

  async deleteSteamLink(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("steam_links")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async setCs2Tracking(tracking: Cs2Tracking): Promise<void> {
    const { error } = await this.client.from("cs2_tracking").upsert({
      chat_id: tracking.chatId,
      user_id: tracking.userId,
      auth_code: tracking.authCode,
      last_share_code: tracking.lastShareCode,
      status: tracking.status,
    });
    if (error) throw error;
  }

  async getCs2Tracking(chatId: number, userId: number): Promise<Cs2Tracking | undefined> {
    const { data, error } = await this.client
      .from("cs2_tracking")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToCs2Tracking(data) : undefined;
  }

  async deleteCs2Tracking(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async listActiveCs2Tracking(): Promise<Cs2Tracking[]> {
    const { data, error } = await this.client.from("cs2_tracking").select("*").eq("status", "active");
    if (error) throw error;
    return (data ?? []).map(rowToCs2Tracking);
  }

  async updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .update({ last_share_code: lastShareCode })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async markCs2TrackingBroken(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .update({ status: "broken" })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged"> {
    const { data: existing, error: selectError } = await this.client
      .from("match_queue")
      .select("id, player_ids")
      .eq("chat_id", chatId)
      .eq("share_code", shareCode)
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const merged = [...new Set([...(existing.player_ids ?? []), ...playerIds])];
      const { error } = await this.client.from("match_queue").update({ player_ids: merged }).eq("id", existing.id);
      if (error) throw error;
      return "merged";
    }

    const { error } = await this.client.from("match_queue").insert({
      chat_id: chatId,
      share_code: shareCode,
      player_ids: playerIds,
    });
    if (error) throw error;
    return "inserted";
  }
}

function rowToMember(row: any): Member {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    firstName: row.first_name,
    username: row.username ?? undefined,
    birthday: row.birthday ?? undefined,
  };
}

function rowToRole(row: any): Role {
  return { id: String(row.id), chatId: row.chat_id, name: row.name };
}

function rowToSteamLinkToken(row: any): SteamLinkToken {
  return {
    token: row.token,
    chatId: row.chat_id,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

function rowToCs2Tracking(row: any): Cs2Tracking {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    authCode: row.auth_code,
    lastShareCode: row.last_share_code,
    status: row.status,
  };
}
