import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleSetBirthday, handleBirthdays } from "../../src/commands/birthdayCommands";

describe("birthday commands", () => {
  it("saves a valid birthday", async () => {
    const store = new InMemoryStore();
    const reply = await handleSetBirthday(store, { chatId: 1, userId: 100, firstName: "Ada" }, "24-12");
    expect(reply).toBe("Birthday saved: 24 December.");
    expect(await store.getMember(1, 100)).toEqual({
      chatId: 1,
      userId: 100,
      firstName: "Ada",
      birthday: "12-24",
    });
  });

  it.each(["not-a-date", "32-01", "30-02", "01-13", "0-1"])(
    "rejects an invalid birthday: %s",
    async (raw) => {
      const store = new InMemoryStore();
      const reply = await handleSetBirthday(store, { chatId: 1, userId: 100, firstName: "Ada" }, raw);
      expect(reply).toBe("Usage: /setbirthday DD-MM (e.g. /setbirthday 24-12)");
    },
  );

  it("accepts Feb 29 (leap day)", async () => {
    const store = new InMemoryStore();
    const reply = await handleSetBirthday(store, { chatId: 1, userId: 100, firstName: "Ada" }, "29-02");
    expect(reply).toBe("Birthday saved: 29 February.");
  });

  it("reports when nobody has set a birthday", async () => {
    const store = new InMemoryStore();
    const reply = await handleBirthdays(store, 1);
    expect(reply).toBe("No birthdays have been set yet. Use /setbirthday DD-MM to add yours.");
  });

  it("lists birthdays soonest-first, wrapping around the year", async () => {
    const store = new InMemoryStore();
    const now = new Date(2026, 0, 10); // Jan 10, 2026

    await handleSetBirthday(store, { chatId: 1, userId: 1, firstName: "SoonAfter" }, "15-01"); // 5 days away
    await handleSetBirthday(store, { chatId: 1, userId: 2, firstName: "Today" }, "10-01"); // today
    await handleSetBirthday(store, { chatId: 1, userId: 3, firstName: "WrapsToNextYear" }, "01-01"); // wraps

    const reply = await handleBirthdays(store, 1, now);
    expect(reply).toBe(
      "Today — 10 January (today! 🎂)\n" +
        "SoonAfter — 15 January (in 5 days)\n" +
        "WrapsToNextYear — 1 January (in 356 days)",
    );
  });

  it("excludes members without a birthday from the list", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 1, firstName: "NoBirthday" });
    await handleSetBirthday(store, { chatId: 1, userId: 2, firstName: "HasBirthday" }, "01-06");

    const reply = await handleBirthdays(store, 1, new Date(2026, 0, 1));
    expect(reply).toBe("HasBirthday — 1 June (in 151 days)");
  });
});
