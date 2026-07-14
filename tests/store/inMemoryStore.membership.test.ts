import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore role membership", () => {
  it("assigns a member to a role and lists them", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await store.createRole(1, "Designers");

    await store.assignUserToRole(role.id, 100);

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([{ chatId: 1, userId: 100, firstName: "Ada" }]);
  });

  it("unassigns a member from a role", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    await store.unassignUserFromRole(role.id, 100);

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([]);
  });

  it("returns all roles a user belongs to in a chat", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const designers = await store.createRole(1, "Designers");
    const mods = await store.createRole(1, "Moderators");
    await store.assignUserToRole(designers.id, 100);
    await store.assignUserToRole(mods.id, 100);

    const roles = await store.getUserRoles(1, 100);
    expect(roles.map((r) => r.name).sort()).toEqual(["Designers", "Moderators"]);
  });

  it("getRoleMembers returns an empty array for an unknown roleId", async () => {
    const store = new InMemoryStore();
    const members = await store.getRoleMembers("does-not-exist");
    expect(members).toEqual([]);
  });
});
