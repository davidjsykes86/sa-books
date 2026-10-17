import { Doc } from 'fyo/model/doc';
import {
  ChangeArg,
  DefaultMap,
  FiltersMap,
  FormulaMap,
  HiddenMap,
  ReadOnlyMap,
} from 'fyo/model/types';
import { Money } from 'pesa';
import {
  calcVatInclusive,
  getTaxInfo,
  LineType,
} from '../CashbookBatch/batchHelpers';

/**
 * Pastel-style journal line: Type (GL / Customer / Supplier) then ONE
 * Account box. In Customer / Supplier journals the type is fixed.
 */
export class JournalBatchLine extends Doc {
  date?: Date;
  reference?: string;
  lineType?: LineType;
  refType?: string;
  entryAccount?: string;
  account?: string;
  party?: string;
  description?: string;
  debit?: Money;
  credit?: Money;
  tax?: string;
  vatAmount?: Money;
  contraAccount?: string;

  get journalType(): string {
    return (this.parentdoc?.get('batchType') as string | undefined) ?? 'General';
  }

  get isGL(): boolean {
    return (this.lineType ?? 'GL') === 'GL';
  }

  get vatEnabled(): boolean {
    return !!this.fyo.singles.AccountingSettings?.vatRegistered;
  }

  get grossAmount(): Money {
    const zero = this.fyo.pesa(0);
    const debit = this.debit ?? zero;
    const credit = this.credit ?? zero;
    return debit.isZero() ? credit : debit;
  }

  // VAT sits on the GL side: the line itself (General, GL line) or the
  // contra account (Customer / Supplier journals).
  get vatApplies(): boolean {
    if (this.journalType === 'General') {
      return this.isGL;
    }

    return !!this.contraAccount;
  }

  async getVat(): Promise<Money> {
    const zero = this.fyo.pesa(0);
    if (!this.vatEnabled || !this.tax || !this.vatApplies) {
      return zero;
    }

    const gross = this.grossAmount;
    if (gross.isZero()) {
      return zero;
    }

    const info = await getTaxInfo(this.fyo, this.tax);
    if (!info) {
      return zero;
    }

    return calcVatInclusive(this.fyo, gross, info.rate);
  }

  formulas: FormulaMap = {
    lineType: {
      // Customer / Supplier journals: every line is that type.
      formula: () =>
        this.journalType === 'General' ? undefined : this.journalType,
    },
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
      dependsOn: ['debit', 'credit', 'tax', 'contraAccount', 'lineType'],
    },
  };

  async change(ch: ChangeArg) {
    if (ch.changed === 'lineType' && this.entryAccount) {
      await this.set('entryAccount', '');
    }
  }

  readOnly: ReadOnlyMap = {
    lineType: () => this.journalType !== 'General',
  };

  hidden: HiddenMap = {
    tax: () => !this.vatEnabled,
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
    contraAccount: () => ({ isGroup: false }),
  };

  static defaults: DefaultMap = {
    lineType: (doc) => {
      const type = doc?.parentdoc?.get('batchType') as string | undefined;
      return type === 'Customer' || type === 'Supplier' ? type : 'GL';
    },
    refType: (doc) => {
      const type = doc?.parentdoc?.get('batchType') as string | undefined;
      return type === 'Customer' || type === 'Supplier' ? 'Party' : 'Account';
    },
    date: (doc) =>
      (doc?.parentdoc?.date as Date | undefined) ?? new Date(),
  };
}
