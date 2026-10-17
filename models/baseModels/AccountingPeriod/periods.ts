import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { DateTime } from 'luxon';

export const PERIOD_SCHEMA = 'AccountingPeriod';

type PeriodRow = {
  name: string;
  startDate: unknown;
  endDate: unknown;
  closed?: boolean | number;
};

// Normalise Date / string values to 'YYYY-MM-DD' using local time.
function toISODate(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return DateTime.fromJSDate(value).toISODate();
  }

  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function toDateTime(value: unknown): DateTime | null {
  const iso = toISODate(value);
  return iso ? DateTime.fromISO(iso) : null;
}

// UTC midnight so the stored date never shifts a day in SAST.
function utcDate(d: DateTime): Date {
  return DateTime.fromObject(
    { year: d.year, month: d.month, day: d.day },
    { zone: 'utc' }
  ).toJSDate();
}

function fiscalYearStartFor(dateISO: string, settingStart: DateTime): DateTime {
  const d = DateTime.fromISO(dateISO);
  let start = DateTime.fromObject({
    year: d.year,
    month: settingStart.month,
    day: settingStart.day,
  });

  if (start > d) {
    start = start.minus({ years: 1 });
  }

  return start;
}

function fiscalYearLabel(start: DateTime): string {
  const end = start.plus({ years: 1 }).minus({ days: 1 });
  if (start.year === end.year) {
    return String(start.year);
  }

  return `${start.year}-${String(end.year).slice(-2)}`;
}

export async function ensureFiscalYearPeriods(
  fyo: Fyo,
  fyStart: DateTime
): Promise<void> {
  const label = fiscalYearLabel(fyStart);

  for (let i = 0; i < 12; i++) {
    const name = `${label} P${String(i + 1).padStart(2, '0')}`;
    if (await fyo.db.exists(PERIOD_SCHEMA, name)) {
      continue;
    }

    const start = fyStart.plus({ months: i });
    const end = fyStart.plus({ months: i + 1 }).minus({ days: 1 });

    const doc = fyo.doc.getNewDoc(PERIOD_SCHEMA, {
      name,
      fiscalYear: label,
      periodNumber: i + 1,
      startDate: utcDate(start),
      endDate: utcDate(end),
      closed: false,
    });
    await doc.sync();
  }
}

function getSettingStart(fyo: Fyo): DateTime | null {
  return toDateTime(fyo.singles.AccountingSettings?.fiscalYearStart);
}

let ensuringCurrent: Promise<void> | null = null;

export function ensureCurrentPeriods(fyo: Fyo): Promise<void> {
  if (ensuringCurrent) {
    return ensuringCurrent;
  }

  ensuringCurrent = (async () => {
    const settingStart = getSettingStart(fyo);
    if (!settingStart) {
      return;
    }

    const today = DateTime.local().toISODate()!;
    await ensureFiscalYearPeriods(fyo, fiscalYearStartFor(today, settingStart));
  })().finally(() => {
    ensuringCurrent = null;
  });

  return ensuringCurrent;
}

export async function assertPeriodOpen(
  fyo: Fyo,
  date: unknown,
  action: string
): Promise<void> {
  const iso = toISODate(date);
  if (!iso) {
    return;
  }

  const settingStart = getSettingStart(fyo);
  if (settingStart) {
    await ensureFiscalYearPeriods(fyo, fiscalYearStartFor(iso, settingStart));
  }

  const periods = (await fyo.db.getAll(PERIOD_SCHEMA, {
    fields: ['name', 'startDate', 'endDate', 'closed'],
  })) as PeriodRow[];

  const period = periods.find((p) => {
    const s = toISODate(p.startDate);
    const e = toISODate(p.endDate);
    return !!s && !!e && s <= iso && iso <= e;
  });

  if (period && period.closed) {
    throw new ValidationError(
      t`${action} not allowed: period ${period.name} is closed. Date the entry in an open period, or reopen ${period.name} under Setup → Accounting Periods.`
    );
  }
}