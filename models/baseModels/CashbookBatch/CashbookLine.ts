import { Doc } from 'fyo/model/doc';
import {
  DefaultMap,
  FiltersMap,
  FormulaMap,
  HiddenMap,
} from 'fyo/model/types';
import { Money } from 'pesa';
import { calcVatInclusive, getTaxInfo, LineType } from './batchHelpers';

export class CashbookLine extends Doc {
  date?: Date;
  reference?: string;
  lineType?: LineType;
  account?: string;
  party?: string;
  description?: string;
  amount?: Money;
  tax?: string;
  vatAmount?: Money;

  get vatEnabled(): boolean {
    return !!this.fyo.singles.AccountingSettings?.vatRegistered;
  }

  async getVat(): Promise<Money> {
    const zero = this.fyo.pesa(0);
    if (
      this.lineType !== 'GL' ||
      !this.tax ||
      !this.amount ||
      !this.vatEnabled
    ) {
      return zero;
    }

    const info = await getTaxInfo(this.fyo, this.tax);
    if (!info) {
      return zero;
    }

    return calcVatInclusive(this.fyo, this.amount, info.rate);
  }

  formulas: FormulaMap = {
    vatAmount: {
      formula: async () => await this.getVat(),
      dependsOn: ['amount', 'tax', 'lineType'],
    },
  };

  hidden: HiddenMap = {
    account: () => this.lineType !== 'GL',
    party: () => this.lineType === 'GL',
    tax: () => this.lineType !== 'GL' || !this.vatEnabled,
    vatAmount: () => !this.vatEnabled,
  };

  static filters: FiltersMap = {
    account: () => ({ isGroup: false }),
    party: (doc: Doc) =>
      doc.lineType === 'Supplier'
        ? { role: ['in', ['Supplier', 'Both']] }
        : { role: ['in', ['Customer', 'Both']] },
  };

  static defaults: DefaultMap = {
    lineType: () => 'GL',
    date: (doc) =>
      (doc?.parentdoc?.date as Date | undefined) ?? new Date(),
  };
}