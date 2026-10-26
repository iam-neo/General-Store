/**
 * Lightweight, deterministic Bikram Sambat (BS) date utility for Nepal retail operations.
 * Maps Gregorian (AD) dates to Nepali Bikram Sambat (BS) dates.
 * Covers 2020 AD - 2035 AD (2076 BS - 2092 BS).
 */

// Monthly day counts in Bikram Sambat years [Baisakh, Jestha, Ashadh, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra]
const BS_MONTH_DAYS: Record<number, number[]> = {
  2076: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2083: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 31],
  2085: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2086: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2088: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2089: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2090: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2091: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2092: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
};

// Anchor: 2020-04-13 AD is 2077-01-01 BS (Baisakh 1, 2077)
const ANCHOR_AD_TIME = new Date(Date.UTC(2020, 3, 13)).getTime(); // April 13, 2020 UTC
const ANCHOR_BS_YEAR = 2077;
const ANCHOR_BS_MONTH = 1; // Baisakh
const ANCHOR_BS_DAY = 1;

export const NEPALI_MONTH_NAMES_EN = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const NEPALI_MONTH_NAMES_NE = [
  "बैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कात्तिक",
  "मंसिर",
  "पुस",
  "माघ",
  "फागुन",
  "चैत",
] as const;

const NEPALI_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

export function toNepaliNumerals(num: number | string): string {
  return String(num)
    .split("")
    .map((ch) => {
      const n = parseInt(ch, 10);
      return !isNaN(n) ? NEPALI_DIGITS[n] : ch;
    })
    .join("");
}

/**
 * Converts a Gregorian date (Date object or YYYY-MM-DD string) to Bikram Sambat date string (YYYY-MM-DD).
 */
export function gregorianToBikramSambat(dateInput: Date | string): string {
  let targetDate: Date;
  if (typeof dateInput === "string") {
    // Parse YYYY-MM-DD safely
    const [y, m, d] = dateInput.split("T")[0].split("-").map(Number);
    targetDate = new Date(Date.UTC(y, m - 1, d));
  } else {
    targetDate = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  }

  const diffMs = targetDate.getTime() - ANCHOR_AD_TIME;
  let diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let currentYear = ANCHOR_BS_YEAR;
  let currentMonth = ANCHOR_BS_MONTH;
  let currentDay = ANCHOR_BS_DAY;

  if (diffDays >= 0) {
    while (diffDays > 0) {
      const daysInCurrentMonth = (BS_MONTH_DAYS[currentYear] || BS_MONTH_DAYS[2083])[currentMonth - 1];
      const remainingDaysInMonth = daysInCurrentMonth - currentDay + 1;

      if (diffDays >= remainingDaysInMonth) {
        diffDays -= remainingDaysInMonth;
        currentDay = 1;
        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
      } else {
        currentDay += diffDays;
        diffDays = 0;
      }
    }
  } else {
    diffDays = Math.abs(diffDays);
    while (diffDays > 0) {
      if (diffDays < currentDay) {
        currentDay -= diffDays;
        diffDays = 0;
      } else {
        diffDays -= currentDay;
        currentMonth--;
        if (currentMonth < 1) {
          currentMonth = 12;
          currentYear--;
        }
        const daysInMonth = (BS_MONTH_DAYS[currentYear] || BS_MONTH_DAYS[2077])[currentMonth - 1];
        currentDay = daysInMonth;
      }
    }
  }

  const mm = String(currentMonth).padStart(2, "0");
  const dd = String(currentDay).padStart(2, "0");
  return `${currentYear}-${mm}-${dd}`;
}

/**
 * Returns today's dual calendar dates in ISO YYYY-MM-DD and Bikram Sambat YYYY-MM-DD.
 */
export function getTodayDualDates(): { ad: string; bs: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const ad = `${y}-${m}-${d}`;
  const bs = gregorianToBikramSambat(now);
  return { ad, bs };
}

/**
 * Formats a BS date string (YYYY-MM-DD) into readable localized format.
 * E.g., "2083-07-10" -> "१० कात्तिक २०८३" (ne) or "10 Kartik 2083" (en).
 */
export function formatBikramSambatDate(bsDate: string, locale: "en" | "ne" = "en"): string {
  if (!bsDate) return "—";
  const parts = bsDate.split("-");
  if (parts.length !== 3) return bsDate;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12) {
    return bsDate;
  }

  if (locale === "ne") {
    const monthName = NEPALI_MONTH_NAMES_NE[month - 1];
    return `${toNepaliNumerals(day)} ${monthName} ${toNepaliNumerals(year)}`;
  }

  const monthName = NEPALI_MONTH_NAMES_EN[month - 1];
  return `${day} ${monthName} ${year}`;
}
