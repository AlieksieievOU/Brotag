import { describe, it, expect, vi } from "vitest";
import { getNextShareCode, SHARE_CODE_PATTERN } from "../src/steamMatches";

const ARGS = ["key123", "76561198000000000", "AAAA-BBBBB-CCCC", "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"] as const;

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("getNextShareCode", () => {
  it("returns the next share code", async () => {
    const fetchImpl = mockFetch(200, { result: { nextcode: "CSGO-11111-22222-33333-44444-55555" } });
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: "next", shareCode: "CSGO-11111-22222-33333-44444-55555" });
    const url = (fetchImpl as any).mock.calls[0][0] as string;
    expect(url).toContain("ICSGOPlayers_730/GetNextMatchSharingCode/v1");
    expect(url).toContain("key=key123");
    expect(url).toContain("steamid=76561198000000000");
    expect(url).toContain("steamidkey=AAAA-BBBBB-CCCC");
    expect(url).toContain(`knowncode=${encodeURIComponent(ARGS[3])}`);
  });

  it("reports up-to-date when Steam returns n/a", async () => {
    const fetchImpl = mockFetch(200, { result: { nextcode: "n/a" } });
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "upToDate" });
  });

  it("reports up-to-date when the body has no nextcode", async () => {
    const fetchImpl = mockFetch(200, { result: {} });
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "upToDate" });
  });

  it.each([401, 403])("reports authFailed on HTTP %d", async (status) => {
    const fetchImpl = mockFetch(status, {});
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "authFailed" });
  });

  it("reports error on other HTTP failures", async () => {
    const fetchImpl = mockFetch(500, {});
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result.kind).toBe("error");
  });

  it("reports error when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result.kind).toBe("error");
  });
});

describe("SHARE_CODE_PATTERN", () => {
  it("accepts a well-formed share code", () => {
    expect(SHARE_CODE_PATTERN.test("CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee")).toBe(true);
  });

  it.each(["CSGO-aaaa-bbbbb-ccccc-ddddd-eeeee", "csgo-aaaaa-bbbbb-ccccc-ddddd-eeeee", "CSGO-aaaaa-bbbbb-ccccc-ddddd", "steam://CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"])(
    "rejects %s",
    (code) => {
      expect(SHARE_CODE_PATTERN.test(code)).toBe(false);
    },
  );
});
