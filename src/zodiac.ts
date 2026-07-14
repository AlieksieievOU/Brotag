export interface ZodiacSign {
  /** English key expected by the horoscope API, e.g. "aries". */
  apiKey: string;
  /** Ukrainian display name with symbol, e.g. "Овен ♈". */
  label: string;
}

// [monthDayStart, sign] pairs, in year order. A birthday's sign is the last
// entry whose start date is <= the birthday (walking backwards from Dec 31,
// wrapping to Capricorn for anything before Jan 20).
const ZODIAC_RANGES: Array<{ start: string; sign: ZodiacSign }> = [
  { start: "01-20", sign: { apiKey: "aquarius", label: "Водолій ♒" } },
  { start: "02-19", sign: { apiKey: "pisces", label: "Риби ♓" } },
  { start: "03-21", sign: { apiKey: "aries", label: "Овен ♈" } },
  { start: "04-20", sign: { apiKey: "taurus", label: "Телець ♉" } },
  { start: "05-21", sign: { apiKey: "gemini", label: "Близнюки ♊" } },
  { start: "06-21", sign: { apiKey: "cancer", label: "Рак ♋" } },
  { start: "07-23", sign: { apiKey: "leo", label: "Лев ♌" } },
  { start: "08-23", sign: { apiKey: "virgo", label: "Діва ♍" } },
  { start: "09-23", sign: { apiKey: "libra", label: "Терези ♎" } },
  { start: "10-23", sign: { apiKey: "scorpio", label: "Скорпіон ♏" } },
  { start: "11-22", sign: { apiKey: "sagittarius", label: "Стрілець ♐" } },
  { start: "12-22", sign: { apiKey: "capricorn", label: "Козеріг ♑" } },
];

/** @param monthDay "MM-DD" as stored on Member.birthday */
export function zodiacSignFor(monthDay: string): ZodiacSign {
  let current = ZODIAC_RANGES[ZODIAC_RANGES.length - 1].sign; // Capricorn wraps into January
  for (const { start, sign } of ZODIAC_RANGES) {
    if (monthDay >= start) current = sign;
    else break;
  }
  return current;
}
