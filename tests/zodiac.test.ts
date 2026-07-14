import { describe, it, expect } from "vitest";
import { zodiacSignFor } from "../src/zodiac";

describe("zodiacSignFor", () => {
  it.each([
    ["01-01", "capricorn"],
    ["01-19", "capricorn"],
    ["01-20", "aquarius"],
    ["02-18", "aquarius"],
    ["02-19", "pisces"],
    ["03-20", "pisces"],
    ["03-21", "aries"],
    ["04-19", "aries"],
    ["04-20", "taurus"],
    ["05-20", "taurus"],
    ["05-21", "gemini"],
    ["06-20", "gemini"],
    ["06-21", "cancer"],
    ["07-22", "cancer"],
    ["07-23", "leo"],
    ["08-22", "leo"],
    ["08-23", "virgo"],
    ["09-22", "virgo"],
    ["09-23", "libra"],
    ["10-22", "libra"],
    ["10-23", "scorpio"],
    ["11-21", "scorpio"],
    ["11-22", "sagittarius"],
    ["12-21", "sagittarius"],
    ["12-22", "capricorn"],
    ["12-31", "capricorn"],
  ])("maps %s to %s", (monthDay, expected) => {
    expect(zodiacSignFor(monthDay).apiKey).toBe(expected);
  });
});
