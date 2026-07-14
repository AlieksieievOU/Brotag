import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Member, Role, Store } from "./types.js";

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
}

function rowToMember(row: any): Member {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    firstName: row.first_name,
    username: row.username ?? undefined,
  };
}

function rowToRole(row: any): Role {
  return { id: String(row.id), chatId: row.chat_id, name: row.name };
}
