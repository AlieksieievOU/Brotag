import type { Member } from "../store/types.js";
import { zodiacSignFor } from "../zodiac.js";

const HOROSCOPE_API_URL = "https://freehoroscopeapi.com/api/v1/get-horoscope/daily";
const TRANSLATE_API_URL = "https://api.mymemory.translated.net/get";

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

// MyMemory's free tier caps requests around 500 chars, so each sentence is
// translated separately (also keeps translation quality higher per-segment).
async function translateToUkrainian(text: string, fetchImpl: Fetcher): Promise<string> {
  const sentences = (text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

  const translated = await Promise.all(
    sentences.map(async (sentence) => {
      try {
        const url = `${TRANSLATE_API_URL}?q=${encodeURIComponent(sentence)}&langpair=en|uk`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`Translate API returned ${response.status}`);
        const body = (await response.json()) as { responseData?: { translatedText?: string } };
        return body.responseData?.translatedText || sentence;
      } catch (err) {
        console.error("Failed to translate horoscope sentence:", err);
        return sentence;
      }
    }),
  );

  return translated.join(" ");
}

export async function handleHoroscope(
  target: Member | undefined,
  fetchImpl: Fetcher = fetch,
): Promise<string> {
  if (!target) {
    return "Не вдалося визначити користувача. Дайте відповідь на одне з його повідомлень або вкажіть @username, і переконайтеся, що ця людина вже писала в цьому чаті.";
  }
  if (!target.birthday) {
    return `${target.firstName} ще не вказав(-ла) дату народження. Попросіть спочатку виконати /setbirthday ДД-ММ.`;
  }

  const sign = zodiacSignFor(target.birthday);
  let horoscopeText: string;
  try {
    const response = await fetchImpl(`${HOROSCOPE_API_URL}?sign=${sign.apiKey}&day=today`);
    if (!response.ok) throw new Error(`Horoscope API returned ${response.status}`);
    const body = (await response.json()) as { data?: { horoscope?: string } };
    if (!body.data?.horoscope) throw new Error("Horoscope API returned no data");
    horoscopeText = await translateToUkrainian(body.data.horoscope, fetchImpl);
  } catch (err) {
    console.error("Failed to fetch horoscope:", err);
    return "Зірки зараз недоступні (API гороскопів не відповідає). Спробуй пізніше.";
  }

  const joke = pickJoke(target.userId);
  return `🔮 Гороскоп для ${target.firstName} (${sign.label}) на сьогодні:\n\n${horoscopeText}\n\n${joke}`;
}
