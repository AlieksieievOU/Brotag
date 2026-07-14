export interface Member {
  chatId: number;
  userId: number;
  username?: string;
  firstName: string;
  /** Recurring birthday, stored as "MM-DD" (no year). */
  birthday?: string;
}

export interface Role {
  id: string;
  chatId: number;
  name: string;
}

export interface Store {
  upsertMember(member: Member): Promise<void>;
  deleteMember(chatId: number, userId: number): Promise<void>;
  getMembers(chatId: number): Promise<Member[]>;
  getMember(chatId: number, userId: number): Promise<Member | undefined>;
  findMemberByUsername(chatId: number, username: string): Promise<Member | undefined>;
  setBirthday(chatId: number, userId: number, birthday: string): Promise<void>;

  createRole(chatId: number, name: string): Promise<Role>;
  deleteRole(chatId: number, name: string): Promise<void>;
  findRole(chatId: number, name: string): Promise<Role | undefined>;
  listRoles(chatId: number): Promise<Role[]>;

  assignUserToRole(roleId: string, userId: number): Promise<void>;
  unassignUserFromRole(roleId: string, userId: number): Promise<void>;
  getRoleMembers(roleId: string): Promise<Member[]>;
  getUserRoles(chatId: number, userId: number): Promise<Role[]>;
}
