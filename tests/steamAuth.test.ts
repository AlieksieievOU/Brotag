import { describe, it, expect, vi } from "vitest";
import { buildSteamLoginUrl, verifySteamOpenId } from "../src/steamAuth";

describe("buildSteamLoginUrl", () => {
  it("builds a Steam OpenID checkid_setup URL", () => {
    const url = buildSteamLoginUrl("https://example.com/api/steam-link/callback?token=abc", "https://example.com");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(parsed.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(parsed.searchParams.get("openid.return_to")).toBe(
      "https://example.com/api/steam-link/callback?token=abc",
    );
    expect(parsed.searchParams.get("openid.realm")).toBe("https://example.com");
  });
});

describe("verifySteamOpenId", () => {
  const validQuery = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000",
    "openid.identity": "https://steamcommunity.com/openid/id/76561198000000000",
  };

  it("returns the steamid64 when Steam confirms the response is valid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n",
    });

    const steamId = await verifySteamOpenId(validQuery, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBe("76561198000000000");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://steamcommunity.com/openid/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns undefined when Steam rejects the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n",
    });

    const steamId = await verifySteamOpenId(validQuery, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBeUndefined();
  });

  it("returns undefined without calling fetch when claimed_id is missing", async () => {
    const fetchImpl = vi.fn();

    const steamId = await verifySteamOpenId({ "openid.mode": "id_res" }, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns undefined when claimed_id doesn't match Steam's format", async () => {
    const fetchImpl = vi.fn();

    const steamId = await verifySteamOpenId(
      { "openid.claimed_id": "https://example.com/not-steam" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(steamId).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
