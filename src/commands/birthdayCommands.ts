import type { Member, Store } from "../store/types.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const INVALID_BIRTHDAY_MESSAGE = "Usage: /setbirthday DD-MM (e.g. /setbirthday 24-12)";

function parseBirthday(raw: string): string | undefined {
  const match = /^(\d{1,2})[.\-/](\d{1,2})$/.exec(raw.trim());
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return undefined;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatMonthDay(monthDay: string): string {
  const [mm, dd] = monthDay.split("-").map(Number);
  return `${dd} ${MONTH_NAMES[mm - 1]}`;
}

function daysUntil(monthDay: string, today: Date): number {
  const [mm, dd] = monthDay.split("-").map(Number);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(startOfToday.getFullYear(), mm - 1, dd);
  if (next < startOfToday) next = new Date(startOfToday.getFullYear() + 1, mm - 1, dd);
  return Math.round((next.getTime() - startOfToday.getTime()) / 86_400_000);
}

export async function handleSetBirthday(store: Store, target: Member, rawInput: string): Promise<string> {
  const monthDay = parseBirthday(rawInput);
  if (!monthDay) return INVALID_BIRTHDAY_MESSAGE;
  await store.upsertMember(target);
  await store.setBirthday(target.chatId, target.userId, monthDay);
  return `Birthday saved: ${formatMonthDay(monthDay)}.`;
}

export async function handleBirthdays(store: Store, chatId: number, now: Date = new Date()): Promise<string> {
  const members = await store.getMembers(chatId);
  const withBirthdays = members.filter((m): m is Member & { birthday: string } => !!m.birthday);
  if (withBirthdays.length === 0) {
    return "No birthdays have been set yet. Use /setbirthday DD-MM to add yours.";
  }

  const sorted = [...withBirthdays].sort(
    (a, b) => daysUntil(a.birthday, now) - daysUntil(b.birthday, now),
  );

  return sorted
    .map((member) => {
      const days = daysUntil(member.birthday, now);
      const when = days === 0 ? "today! 🎂" : days === 1 ? "tomorrow" : `in ${days} days`;
      return `${member.firstName} — ${formatMonthDay(member.birthday)} (${when})`;
    })
    .join("\n");
}
