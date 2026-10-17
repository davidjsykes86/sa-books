import { Doc } from 'fyo/model/doc';
import {
  ChangeArg,
  DefaultMap,
  FiltersMap,
  FormulaMap,
  HiddenMap,
} from 'fyo/model/types';
import { Money } from 'pesa';
import { calcVatInclusive, getTaxInfo, LineType } from './batchHelpers';

/**
 * Pastel-style cashbook line: pick Type (GL / Customer / Supplier),
 * then ONE Account box that lists GL accounts or customers/suppliers.
 * The choice is copied into `account` or `party` for posting.
 */
export class CashbookLine extends Doc {
  date?: Date;
  reference?: string;
  lineType?: LineType;
  refType?: string;
  entryAccount?: string;
  account?: string;
  party?: string;
  description?: string;
  amount?: Money;
  tax?: string;
  vatAmount?: Money;

  get isGL(): boolean {
    return (this.lineType ?? 'GL') === 'GL';
  }

  get vatEnabled(): boolean {
    return !!this.fyo.singles.AccountingSettings?.vatRegistered;
  }

  async getVat(): Promise<Money> {
    const zero = this.fyo.pesa(0);
    if (!this.isGL || !this.tax || !this.amount || !this.vatEnabled) {
      return zero;
    }

    const info = await getTaxInfo(this.fyo, this.tax);
    if (!info) {
      return zero;
    }

    return calcVatInclusive(this.fyo, this.amount, info.rate);
  }

  formulas: FormulaMap = {
    refType: {
      formula: () => (this.isGL ? 'Account' : 'Party'),
      dependsOn: ['lineType'],
    },
    account: {
      formula: () => (this.isGL ? this.entryAccount ?? '' : ''),
      dependsOn: ['entryAccount', 'lineType'],
    },
    party: {
      formula: () => (this.isGL ? '' : this.entryAccount ?? ''),
      dependsOn: ['entryAccount', 'lineType'],
    },
    vatAmount: {
      formula: async () => await this.getVat(),
      dependsOn: ['amount', 'tax', 'lineType'],
    },
  };

  async change(ch: ChangeArg) {
    if (ch.changed === 'lineType' && this.entryAccount) {
      await this.set('entryAccount', '');
    }
  }

  hidden: HiddenMap = {
    tax: () => !this.isGL || !this.vatEnabled,
    vatAmount: () => !this.vatEnabled,
  };

  static filters: FiltersMap = {
    entryAccount: (doc: Doc) => {
      if (doc.lineType === 'Customer') {
        return { role: ['in', ['Customer', 'Both']] };
      }

      if (doc.lineType === 'Supplier') {
        return { role: ['in', ['Supplier', 'Both']] };
      }

      return { isGroup: false };
    },
  };

  static defaults: DefaultMap = {
    lineType: () => 'GL',
    refType: () => 'Account',
    date: (doc) =>
      (doc?.parentdoc?.date as Date | undefined) ?? new Date(),
  };
}
