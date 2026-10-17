import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { Money } from 'pesa';

export type LineType = 'GL' | 'Customer' | 'Supplier';

export async function getTaxInfo(
  fyo: Fyo,
  tax: string
): Promise<{ rate: number; account: string } | null> {
  const rows = (await fyo.db.getAll('TaxDetail', {
    fields: ['account', 'rate'],
    filters: { parent: tax },
  })) as { account: string; rate: number }[];

  if (!rows.length) {
    return null;
  }

  const rate = rows.reduce((sum, r) => sum + Number(r.rate || 0), 0);
  return { rate, account: rows[0].account };
}

// VAT portion of a VAT-inclusive amount, rounded to cents.
export function calcVatInclusive(fyo: Fyo, amount: Money, rate: number): Money {
  if (!rate) {
    return fyo.pesa(0);
  }

  const gross = amount.float;
  const vat = Math.round(((gross * rate) / (100 + rate)) * 100) / 100;
  return fyo.pesa(vat);
}

// Debtors / Creditors control account from the chart (by account type).
export async function getControlAccount(
  fyo: Fyo,
  lineType: LineType
): Promise<string> {
  const accountType = lineType === 'Customer' ? 'Receivable' : 'Payable';
  const rows = (await fyo.db.getAll('Account', {
    fields: ['name', 'isGroup'],
    filters: { accountType },
  })) as { name: string; isGroup?: boolean | number }[];

  const leaf = rows.find((r) => !r.isGroup);
  if (!leaf) {
    throw new ValidationError(
      t`No ${accountType} control account found in the chart of accounts.`
    );
  }

  return leaf.name;
}