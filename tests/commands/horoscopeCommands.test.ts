import { describe, it, expect, vi } from "vitest";
import { handleHoroscope } from "../../src/commands/horoscopeCommands";
import type { Member } from "../../src/store/types";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

// Routes the horoscope-API call to `horoscopeBody` and every translation
// call to a canned Ukrainian response, mirroring how the two APIs are used.
function fakeFetch(horoscopeBody: unknown, translatedText = "Перекладений текст."): typeof fetch {
  return vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.includes("freehoroscopeapi.com")) return jsonResponse(horoscopeBody);
    if (href.includes("mymemory.translated.net")) {
      return jsonResponse({ responseData: { translatedText } });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  }) as unknown as typeof fetch;
}

describe("handleHoroscope", () => {
  it("reports when no target was identified", async () => {
    const reply = await handleHoroscope(undefined);
    expect(reply).toMatch(/Не вдалося визначити користувача/);
  });

  it("asks the target to set a birthday first", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada" };
    const reply = await handleHoroscope(target);
    expect(reply).toBe("Ada ще не вказав(-ла) дату народження. Попросіть спочатку виконати /setbirthday ДД-ММ.");
  });

  it("returns a joke horoscope, translated to Ukrainian, using the target's zodiac sign", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" };
    const fetchImpl = fakeFetch({ data: { horoscope: "Big things ahead." } }, "Попереду великі справи.");

    const reply = await handleHoroscope(target, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("sign=capricorn"));
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("mymemory.translated.net"));
    expect(reply).toContain("Гороскоп для Ada (Козеріг ♑) на сьогодні:");
    expect(reply).toContain("Попереду великі справи.");
    expect(reply).not.toContain("Big things ahead.");
  });

  it("falls back to the original English sentence if translation fails", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" };
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes("freehoroscopeapi.com")) {
        return jsonResponse({ data: { horoscope: "Big things ahead." } });
      }
      return jsonResponse({}, false);
    }) as unknown as typeof fetch;

    const reply = await handleHoroscope(target, fetchImpl);
    expect(reply).toContain("Big things ahead.");
  });

  it("falls back gracefully when the horoscope API fails", async () => {
    const target: Member = { chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" };
    const fetchImpl = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;

    const reply = await handleHoroscope(target, fetchImpl);
    expect(reply).toBe("Зірки зараз недоступні (API гороскопів не відповідає). Спробуй пізніше.");
  });
});
