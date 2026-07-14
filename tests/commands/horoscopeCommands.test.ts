import { describe, it, expect, vi } from "vitest";
import { handleHoroscope } from "../../src/commands/horoscopeCommands";
import type { Member } from "../../src/store/types";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }) as Response,
  ) as unknown as typeof fetch;
}

describe("handleHoroscope", () => {
  it("reports when no target was identified", async () => {
    const reply = await handleHoroscope(undefined);
    expect(reply).toMatch(/Couldn't identify that user/);
  });

  it("asks the target to set a birthday first", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada" };
    const reply = await handleHoroscope(target);
    expect(reply).toBe("Ada hasn't set a birthday yet. Ask them to run /setbirthday DD-MM first.");
  });

  it("returns a joke horoscope using the target's zodiac sign", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" };
    const fetchImpl = fakeFetch({ data: { horoscope: "Big things ahead." } });

    const reply = await handleHoroscope(target, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("sign=capricorn"));
    expect(reply).toContain("Гороскоп для Ada (Козеріг ♑) на сьогодні:");
    expect(reply).toContain("Big things ahead.");
  });

  it("falls back gracefully when the horoscope API fails", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" };
    const fetchImpl = fakeFetch({}, false);

    const reply = await handleHoroscope(target, fetchImpl);
    expect(reply).toBe("Зірки зараз недоступні (API гороскопів не відповідає). Спробуй пізніше.");
  });
});
