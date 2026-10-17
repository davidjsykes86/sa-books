import { t } from 'fyo';
import { Doc } from 'fyo/model/doc';
import { Action } from 'fyo/model/types';
import { DateTime } from 'luxon';
import {
  calcVatInclusive,
  getTaxInfo,
} from 'models/baseModels/CashbookBatch/batchHelpers';
import { Money } from 'pesa';
import { Report } from 'reports/Report';
import { ColumnField, ReportCell, ReportData } from 'reports/types';
import { Field, OptionField } from 'schemas/types';

type VatType = 'STD' | 'ZERO' | 'EXPORT' | 'EXEMPT' | 'CAPITAL';
type Direction = 'output' | 'input';

type VatEntry = {
  date: string;
  valueField: string | null;
  vatField: string | null;
  source: string;
  reference: string;
  party: string;
  account: string;
  value: number;
  vat: number;
};

type SummaryDef = {
  field: string;
  label: string;
  kind: 'value' | 'vat' | 'total';
};

const SUMMARY: SummaryDef[] = [
  { field: '1', label: 'Standard rated supplies (excl. capital goods), incl. VAT', kind: 'value' },
  { field: '1A', label: 'Capital goods supplied, incl. VAT', kind: 'value' },
  { field: '2', label: 'Zero rated supplies (excl. exports)', kind: 'value' },
  { field: '2A', label: 'Exported goods (zero rated)', kind: 'value' },
  { field: '3', label: 'Exempt and non-supplies', kind: 'value' },
  { field: '4', label: 'Output tax on field 1', kind: 'vat' },
  { field: '4A', label: 'Output tax on field 1A', kind: 'vat' },
  { field: '12', label: 'Other output adjustments (bad debts recovered)', kind: 'vat' },
  { field: '13', label: 'TOTAL OUTPUT TAX (4 + 4A + 12)', kind: 'total' },
  { field: '14', label: 'Input tax: capital goods', kind: 'vat' },
  { field: '15', label: 'Input tax: other goods and services', kind: 'vat' },
  { field: '17', label: 'Bad debts written off', kind: 'vat' },
  { field: '19', label: 'TOTAL INPUT TAX (14 + 15 + 17)', kind: 'total' },
  { field: '20', label: 'VAT PAYABLE / (REFUNDABLE) (13 - 19)', kind: 'total' },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toISO(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return DateTime.fromJSDate(value).toISODate();
  }

  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function isBadDebt(account: string): boolean {
  const a = account.toLowerCase();
  return a.includes('bad debt') && !a.includes('recover');
}

function isBadDebtRecovered(account: string): boolean {
  const a = account.toLowerCase();
  return a.includes('bad debt') && a.includes('recover');
}

function classify(
  direction: Direction,
  vatType: VatType,
  account: string
): { valueField: string | null; vatField: string | null } | null {
  if (direction === 'output') {
    if (isBadDebtRecovered(account)) {
      return { valueField: null, vatField: '12' };
    }

    switch (vatType) {
      case 'STD':
        return { valueField: '1', vatField: '4' };
      case 'CAPITAL':
        return { valueField: '1A', vatField: '4A' };
      case 'ZERO':
        return { valueField: '2', vatField: null };
      case 'EXPORT':
        return { valueField: '2A', vatField: null };
      case 'EXEMPT':
        return { valueField: '3', vatField: null };
    }
  }

  if (isBadDebt(account)) {
    return { valueField: null, vatField: '17' };
  }

  switch (vatType) {
    case 'STD':
      return { valueField: null, vatField: '15' };
    case 'CAPITAL':
      return { valueField: null, vatField: '14' };
    default:
      return null; // zero-rated / exempt purchases are not on the VAT201
  }
}

export class VAT201 extends Report {
  static title = t`VAT201`;
  static reportName = 'vat-201';

  fromDate?: string;
  toDate?: string;
  view?: 'Summary' | 'Detail';
  entries: VatEntry[] = [];
  loading = false;

  getLastVatPeriod(): { from: string; to: string } {
    const settings = this.fyo.singles.AccountingSettings;
    const category = (settings?.vatCategory as string | undefined) ?? 'A';

    let ends: number[];
    let length: number;
    switch (category) {
      case 'B':
        ends = [2, 4, 6, 8, 10, 12];
        length = 2;
        break;
      case 'C':
        ends = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        length = 1;
        break;
      case 'D':
        ends = [2, 8];
        length = 6;
        break;
      case 'E': {
        const fyEnd = toISO(settings?.fiscalYearEnd);
        ends = [fyEnd ? DateTime.fromISO(fyEnd).month : 2];
        length = 12;
        break;
      }
      case 'F':
        ends = [2, 6, 10];
        length = 4;
        break;
      default:
        ends = [1, 3, 5, 7, 9, 11];
        length = 2;
    }

    let cursor = DateTime.local().startOf('month').minus({ months: 1 });
    for (let i = 0; i < 24 && !ends.includes(cursor.month); i++) {
      cursor = cursor.minus({ months: 1 });
    }

    const end = cursor.endOf('month');
    const start = cursor.minus({ months: length - 1 }).startOf('month');
    return { from: start.toISODate()!, to: end.toISODate()! };
  }

  setDefaultFilters() {
    if (!this.view) {
      this.view = 'Summary';
    }

    if (!this.fromDate || !this.toDate) {
      const { from, to } = this.getLastVatPeriod();
      this.fromDate ??= from;
      this.toDate ??= to;
    }
  }

  getFilters(): Field[] {
    return [
      {
        fieldtype: 'Select',
        label: t`View`,
        placeholder: t`View`,
        fieldname: 'view',
        options: [
          { value: 'Summary', label: t`Summary` },
          { value: 'Detail', label: t`Detail` },
        ],
      } as OptionField,
      {
        fieldtype: 'Date',
        label: t`From Date`,
        placeholder: t`From Date`,
        fieldname: 'fromDate',
      },
      {
        fieldtype: 'Date',
        label: t`To Date`,
        placeholder: t`To Date`,
        fieldname: 'toDate',
      },
    ] as Field[];
  }

  getColumns(): ColumnField[] {
    if (this.view === 'Detail') {
      return [
        { label: t`Date`, fieldname: 'date', fieldtype: 'Date', width: 0.7 },
        { label: t`Field`, fieldname: 'field', fieldtype: 'Data', width: 0.6 },
        { label: t`Source`, fieldname: 'source', fieldtype: 'Data', width: 0.9 },
        { label: t`Reference`, fieldname: 'reference', fieldtype: 'Data', width: 0.8 },
        { label: t`Party`, fieldname: 'party', fieldtype: 'Data', width: 0.8 },
        { label: t`Account`, fieldname: 'account', fieldtype: 'Data', width: 1.2 },
        { label: t`Value`, fieldname: 'value', fieldtype: 'Currency', width: 0.8 },
        { label: t`VAT`, fieldname: 'vat', fieldtype: 'Currency', width: 0.8 },
      ] as ColumnField[];
    }

    return [
      { label: t`Field`, fieldname: 'field', fieldtype: 'Data', width: 0.5 },
      { label: t`Description`, fieldname: 'description', fieldtype: 'Data', width: 3 },
      { label: t`Amount`, fieldname: 'amount', fieldtype: 'Currency', width: 1 },
    ] as ColumnField[];
  }

  getActions(): Action[] {
    return [];
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    this.entries = await this.collectEntries();
    this.reportData =
      this.view === 'Detail'
        ? this.buildDetail(this.entries)
        : this.buildSummary(this.entries);
    this.loading = false;
  }

  cell(
    value: string,
    rawValue: unknown,
    align: 'left' | 'right' = 'left',
    width = 1,
    bold = false
  ): ReportCell {
    return {
      value,
      rawValue: rawValue as ReportCell['rawValue'],
      align,
      width,
      bold,
    };
  }

  money(n: number): string {
    return this.fyo.format(round2(n), 'Currency');
  }

  buildSummary(entries: VatEntry[]): ReportData {
    const sums = new Map<string, number>();
    const add = (field: string | null, n: number) => {
      if (!field) {
        return;
      }
      sums.set(field, (sums.get(field) ?? 0) + n);
    };

    for (const e of entries) {
      add(e.valueField, e.value);
      add(e.vatField, e.vat);
    }

    const get = (f: string) => round2(sums.get(f) ?? 0);
    const f13 = get('4') + get('4A') + get('12');
    const f19 = get('14') + get('15') + get('17');
    sums.set('13', f13);
    sums.set('19', f19);
    sums.set('20', f13 - f19);

    return SUMMARY.map(({ field, label, kind }) => {
      const amount = get(field);
      const bold = kind === 'total';
      return {
        cells: [
          this.cell(field, field, 'left', 0.5, bold),
          this.cell(label, label, 'left', 3, bold),
          this.cell(this.money(amount), amount, 'right', 1, bold),
        ],
      };
    });
  }

  buildDetail(entries: VatEntry[]): ReportData {
    const sorted = [...entries].sort((a, b) =>
      a.date === b.date ? a.reference.localeCompare(b.reference) : a.date < b.date ? -1 : 1
    );

    return sorted.map((e) => {
      const field = [e.valueField, e.vatField].filter(Boolean).join(' / ');
      return {
        cells: [
          this.cell(this.fyo.format(e.date, 'Date'), e.date, 'left', 0.7),
          this.cell(field, field, 'left', 0.6),
          this.cell(e.source, e.source, 'left', 0.9),
          this.cell(e.reference, e.reference, 'left', 0.8),
          this.cell(e.party, e.party, 'left', 0.8),
          this.cell(e.account, e.account, 'left', 1.2),
          this.cell(this.money(e.value), e.value, 'right', 0.8),
          this.cell(this.money(e.vat), e.vat, 'right', 0.8),
        ],
      };
    });
  }

  async collectEntries(): Promise<VatEntry[]> {
    const from = this.fromDate ?? '';
    const to = this.toDate ?? '';
    const inRange = (d: unknown) => {
      const iso = toISO(d);
      return !!iso && iso >= from && iso <= to;
    };

    const taxCache = new Map<string, { rate: number; vatType: VatType } | null>();
    const getTax = async (name: string) => {
      if (taxCache.has(name)) {
        return taxCache.get(name)!;
      }

      const info = await getTaxInfo(this.fyo, name);
      const row = (await this.fyo.db.get('Tax', name, ['vatType'])) as {
        vatType?: string | null;
      };
      const result =
        info && row?.vatType
          ? { rate: info.rate, vatType: row.vatType as VatType }
          : null;
      taxCache.set(name, result);
      return result;
    };

    const entries: VatEntry[] = [];

    // 1. Sales and purchase invoices (amounts are excl. VAT on the lines)
    const invoiceSources: [string, Direction, string][] = [
      ['SalesInvoice', 'output', t`Sales Invoice`],
      ['PurchaseInvoice', 'input', t`Purchase Invoice`],
    ];

    for (const [schemaName, direction, label] of invoiceSources) {
      const rows = (await this.fyo.db.getAllRaw(schemaName, {
        fields: ['name', 'date'],
        filters: { submitted: true, cancelled: false },
      })) as { name: string; date: string }[];

      for (const row of rows) {
        if (!inRange(row.date)) {
          continue;
        }

        const doc = await this.fyo.doc.getDoc(schemaName, row.name);
        const isReturn = !!doc.get('returnAgainst');
        const party = (doc.get('party') as string) ?? '';

        for (const item of (doc.get('items') as Doc[] | undefined) ?? []) {
          const taxName = item.get('tax') as string | undefined;
          if (!taxName) {
            continue;
          }

          const info = await getTax(taxName);
          if (!info) {
            continue;
          }

          const account = (item.get('account') as string) ?? '';
          const cls = classify(direction, info.vatType, account);
          if (!cls) {
            continue;
          }

          let base = (item.get('amount') as Money | undefined)?.float ?? 0;
          if (isReturn && base > 0) {
            base = -base;
          }

          const vat = round2((base * info.rate) / 100);
          entries.push({
            date: toISO(row.date)!,
            ...cls,
            source: label,
            reference: row.name,
            party,
            account,
            value: round2(base + vat),
            vat,
          });
        }
      }
    }

    // 2. Cashbook batches (amounts are incl. VAT)
    const cashbooks = (await this.fyo.db.getAllRaw('CashbookBatch', {
      fields: ['name', 'batchType'],
      filters: { submitted: true, cancelled: false },
    })) as { name: string; batchType: string }[];

    for (const batch of cashbooks) {
      const doc = await this.fyo.doc.getDoc('CashbookBatch', batch.name);
      const isReceipt = batch.batchType === 'Receipts';
      const direction: Direction = isReceipt ? 'output' : 'input';
      const source = isReceipt ? t`Cashbook Receipts` : t`Cashbook Payments`;

      for (const line of (doc.get('lines') as Doc[] | undefined) ?? []) {
        if ((line.get('lineType') as string) !== 'GL') {
          continue;
        }

        const date = line.get('date') ?? doc.get('date');
        if (!inRange(date)) {
          continue;
        }

        const taxName = line.get('tax') as string | undefined;
        if (!taxName) {
          continue;
        }

        const info = await getTax(taxName);
        if (!info) {
          continue;
        }

        const account = (line.get('account') as string) ?? '';
        const cls = classify(direction, info.vatType, account);
        if (!cls) {
          continue;
        }

        const amount = line.get('amount') as Money | undefined;
        if (!amount) {
          continue;
        }

        const vat = calcVatInclusive(this.fyo, amount, info.rate).float;
        entries.push({
          date: toISO(date)!,
          ...cls,
          source,
          reference: `CB ${batch.name}`,
          party: '',
          account,
          value: round2(amount.float),
          vat: round2(vat),
        });
      }
    }

    // 3. Journal batches (amounts are incl. VAT)
    const journals = (await this.fyo.db.getAllRaw('JournalBatch', {
      fields: ['name', 'batchType'],
      filters: { submitted: true, cancelled: false },
    })) as { name: string; batchType: string }[];

    for (const batch of journals) {
      const doc = await this.fyo.doc.getDoc('JournalBatch', batch.name);
      const type = batch.batchType || 'General';
      const source =
        type === 'Customer'
          ? t`Customer Journal`
          : type === 'Supplier'
          ? t`Supplier Journal`
          : t`General Journal`;

      for (const line of (doc.get('lines') as Doc[] | undefined) ?? []) {
        const date = line.get('date') ?? doc.get('date');
        if (!inRange(date)) {
          continue;
        }

        const taxName = line.get('tax') as string | undefined;
        if (!taxName) {
          continue;
        }

        const info = await getTax(taxName);
        if (!info) {
          continue;
        }

        const zero = this.fyo.pesa(0);
        const debit = (line.get('debit') as Money | undefined) ?? zero;
        const credit = (line.get('credit') as Money | undefined) ?? zero;
        const isDebit = !debit.isZero();
        const amount = isDebit ? debit : credit;
        if (amount.isZero()) {
          continue;
        }

        let direction: Direction;
        let sign = 1;
        let account: string;

        if (type === 'General') {
          if (((line.get('lineType') as string) ?? 'GL') !== 'GL') {
            continue; // customer/supplier lines in a General Journal carry no VAT
          }
          account = (line.get('account') as string) ?? '';
          direction = isDebit ? 'input' : 'output';
        } else if (type === 'Customer') {
          account = (line.get('contraAccount') as string) ?? '';
          if (!isDebit && isBadDebt(account)) {
            direction = 'input'; // bad debt written off: claim VAT back
          } else {
            direction = 'output';
            sign = isDebit ? 1 : -1; // credit to customer reduces output
          }
        } else {
          account = (line.get('contraAccount') as string) ?? '';
          direction = 'input';
          sign = isDebit ? -1 : 1; // debit to supplier reduces input
        }

        const cls = classify(direction, info.vatType, account);
        if (!cls) {
          continue;
        }

        const vat = calcVatInclusive(this.fyo, amount, info.rate).float;
        entries.push({
          date: toISO(date)!,
          ...cls,
          source,
          reference: `JB ${batch.name}`,
          party: (line.get('party') as string) ?? '',
          account,
          value: round2(sign * amount.float),
          vat: round2(sign * vat),
        });
      }
    }

    return entries;
  }
}
