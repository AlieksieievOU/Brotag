import type { Member } from "../store/types.js";
import { zodiacSignFor } from "../zodiac.js";

const HOROSCOPE_API_URL = "https://freehoroscopeapi.com/api/v1/get-horoscope/daily";

const JOKES = [
  "Зірки, звісно, брешуть, але цього разу вони особливо старались.",
  "Не вдячте, подякуйте Сатурну.",
  "Якщо не збудеться — Меркурій знову ретроградний, це не ми.",
  "Гороскоп точний на 12%, решта — імпровізація Всесвіту.",
  "Астролог у відпустці, тому вірте на власний ризик.",
];

function pickJoke(seed: number): string {
  return JOKES[seed % JOKES.length];
}

export type Fetcher = typeof fetch;

export async function handleHoroscope(
  target: Member | undefined,
  fetchImpl: Fetcher = fetch,
): Promise<string> {
  if (!target) {
    return "Couldn't identify that user. Reply to one of their messages, or use @username, and make sure they've posted in this group before.";
  }
  if (!target.birthday) {
    return `${target.firstName} hasn't set a birthday yet. Ask them to run /setbirthday DD-MM first.`;
  }

  const sign = zodiacSignFor(target.birthday);
  let horoscopeText: string;
  try {
    const response = await fetchImpl(`${HOROSCOPE_API_URL}?sign=${sign.apiKey}&day=today`);
    if (!response.ok) throw new Error(`Horoscope API returned ${response.status}`);
    const body = (await response.json()) as { data?: { horoscope?: string } };
    if (!body.data?.horoscope) throw new Error("Horoscope API returned no data");
    horoscopeText = body.data.horoscope;
  } catch (err) {
    console.error("Failed to fetch horoscope:", err);
    return "Зірки зараз недоступні (API гороскопів не відповідає). Спробуй пізніше.";
  }

  const joke = pickJoke(target.userId);
  return `🔮 Гороскоп для ${target.firstName} (${sign.label}) на сьогодні:\n\n${horoscopeText}\n\n${joke}`;
}
