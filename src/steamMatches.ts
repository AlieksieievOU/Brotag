const NEXT_CODE_ENDPOINT = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/";

export const SHARE_CODE_PATTERN = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

export type NextCodeResult =
  | { kind: "next"; shareCode: string }
  | { kind: "upToDate" }
  | { kind: "authFailed" }
  | { kind: "error"; detail: string };

export async function getNextShareCode(
  apiKey: string,
  steamId64: string,
  authCode: string,
  knownCode: string,
  fetchImpl: typeof fetch,
): Promise<NextCodeResult> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId64,
    steamidkey: authCode,
    knowncode: knownCode,
  });
  let response: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    response = await fetchImpl(`${NEXT_CODE_ENDPOINT}?${params.toString()}`);
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }

  // Valve rejects a bad or expired steamidkey with 401/403; anything else
  // non-2xx (rate limit, outage) is transient and must not break tracking.
  if (response.status === 401 || response.status === 403) return { kind: "authFailed" };
  if (!response.ok) return { kind: "error", detail: `HTTP ${response.status}` };

  let body: any;
  try {
    body = await response.json();
  } catch (err) {
    return { kind: "error", detail: `bad JSON: ${String(err)}` };
  }
  const nextcode = body?.result?.nextcode;
  if (typeof nextcode === "string" && SHARE_CODE_PATTERN.test(nextcode)) {
    return { kind: "next", shareCode: nextcode };
  }
  return { kind: "upToDate" };
}
