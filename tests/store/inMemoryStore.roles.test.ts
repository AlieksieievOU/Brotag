import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore role CRUD", () => {
  it("creates a role and finds it by name", async () => {
    const store = new InMemoryStore();
    const created = await store.createRole(1, "Designers");

    const found = await store.findRole(1, "Designers");
    expect(found).toEqual(created);
  });

  it("lists all roles for a chat", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    await store.createRole(1, "Moderators");
    await store.createRole(2, "OtherChatRole");

    const roles = await store.listRoles(1);
    expect(roles.map((r) => r.name).sort()).toEqual(["Designers", "Moderators"]);
  });

  it("deletes a role by name", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    await store.deleteRole(1, "Designers");

    const found = await store.findRole(1, "Designers");
    expect(found).toBeUndefined();
  });

  it("deleting a nonexistent role is a no-op, not an error", async () => {
    const store = new InMemoryStore();
    await expect(store.deleteRole(1, "Nope")).resolves.toBeUndefined();
  });

  it("scopes role names by chatId (same name allowed in different chats)", async () => {
    const store = new InMemoryStore();
    const roleA = await store.createRole(1, "Designers");
    const roleB = await store.createRole(2, "Designers");
    expect(roleA.id).not.toEqual(roleB.id);
  });
});
