import { Doc } from 'fyo/model/doc';
import {
  DefaultMap,
  FiltersMap,
  FormulaMap,
  HiddenMap,
} from 'fyo/model/types';
import { Money } from 'pesa';
import {
  calcVatInclusive,
  getTaxInfo,
} from '../CashbookBatch/batchHelpers';

export class JournalBatchLine extends Doc {
  date?: Date;
  reference?: string;
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

  get vatEnabled(): boolean {
    return !!this.fyo.singles.AccountingSettings?.vatRegistered;
  }

  get grossAmount(): Money {
    const zero = this.fyo.pesa(0);
    const debit = this.debit ?? zero;
    const credit = this.credit ?? zero;
    return debit.isZero() ? credit : debit;
  }

  async getVat(): Promise<Money> {
    const zero = this.fyo.pesa(0);
    if (!this.vatEnabled || !this.tax) {
      return zero;
    }

    // Customer/Supplier journals: VAT sits on the contra GL account.
    if (this.journalType !== 'General' && !this.contraAccount) {
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
    vatAmount: {
      formula: async () => await this.getVat(),
      dependsOn: ['debit', 'credit', 'tax', 'contraAccount'],
    },
  };

  hidden: HiddenMap = {
    account: () => this.journalType !== 'General',
    party: () => this.journalType === 'General',
    tax: () => !this.vatEnabled,
    vatAmount: () => !this.vatEnabled,
  };

  static filters: FiltersMap = {
    account: () => ({ isGroup: false }),
    contraAccount: () => ({ isGroup: false }),
    party: (doc: Doc) =>
      doc.parentdoc?.get('batchType') === 'Supplier'
        ? { role: ['in', ['Supplier', 'Both']] }
        : { role: ['in', ['Customer', 'Both']] },
  };

  static defaults: DefaultMap = {
    date: (doc) =>
      (doc?.parentdoc?.date as Date | undefined) ?? new Date(),
  };
}
