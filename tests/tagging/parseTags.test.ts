import { describe, it, expect } from "vitest";
import { parseTags } from "../../src/tagging/parseTags";

describe("parseTags", () => {
  it("finds a single @all tag", () => {
    expect(parseTags("hey @all check this out")).toEqual(["all"]);
  });

  it("finds a single role tag", () => {
    expect(parseTags("@Designers can you review?")).toEqual(["Designers"]);
  });

  it("finds multiple distinct tags in one message", () => {
    expect(parseTags("@all and also @Designers please")).toEqual(["all", "Designers"]);
  });

  it("deduplicates repeated tags, keeping first-seen order", () => {
    expect(parseTags("@Designers @Moderators @Designers")).toEqual(["Designers", "Moderators"]);
  });

  it("returns an empty array when there are no tags", () => {
    expect(parseTags("just a normal message")).toEqual([]);
  });

  it("ignores an email-like string that merely contains an @", () => {
    expect(parseTags("contact me at ada@example.com")).toEqual([]);
  });

  it("is case-sensitive for role names but not for the all keyword casing itself", () => {
    expect(parseTags("@ALL")).toEqual([]);
  });

  it("extracts a lowercase-initial role tag", () => {
    expect(parseTags("@devs ping")).toEqual(["devs"]);
  });

  it("extracts an all-caps role tag", () => {
    expect(parseTags("@QA ping")).toEqual(["QA"]);
  });
});
