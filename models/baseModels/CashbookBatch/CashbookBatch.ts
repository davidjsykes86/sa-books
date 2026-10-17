import { Fyo, t } from 'fyo';
import { Doc } from 'fyo/model/doc';
import {
  Action,
  DefaultMap,
  FiltersMap,
  FormulaMap,
  ListViewSettings,
} from 'fyo/model/types';
import { ValidationError } from 'fyo/utils/errors';
import {
  getDocStatus,
  getLedgerLinkAction,
  getStatusText,
  statusColor,
} from 'models/helpers';
import { BatchPosting } from 'models/Transactional/BatchPosting';
import { Transactional } from 'models/Transactional/Transactional';
import { Money } from 'pesa';
import { assertPeriodOpen } from '../AccountingPeriod/periods';
import {
  calcVatInclusive,
  getControlAccount,
  getTaxInfo,
  LineType,
} from './batchHelpers';

export class CashbookBatch extends Transactional {
  batchType?: 'Payments' | 'Receipts';
  bankAccount?: string;
  lines?: Doc[];
  totalAmount?: Money;
  totalVat?: Money;

  sumLines(field: string): Money {
    return (this.lines ?? []).reduce((acc, line) => {
      const value = line.get(field) as Money | undefined;
      return value ? acc.add(value) : acc;
    }, this.fyo.pesa(0));
  }

  formulas: FormulaMap = {
    totalAmount: { formula: () => this.sumLines('amount') },
    totalVat: { formula: () => this.sumLines('vatAmount') },
  };

  validateLines(): void {
    const lines = this.lines ?? [];
    if (!lines.length) {
      throw new ValidationError(t`Add at least one line.`);
    }

    lines.forEach((line, i) => {
      const row = i + 1;
      const amount = line.get('amount') as Money | undefined;
      if (!amount || amount.lte(0)) {
        throw new ValidationError(
          t`Line ${row}: amount must be more than zero.`
        );
      }

      const lineType = (line.get('lineType') as LineType) ?? 'GL';
      if (lineType === 'GL') {
        const account = line.get('account') as string | undefined;
        if (!account) {
          throw new ValidationError(t`Line ${row}: choose a GL account.`);
        }

        if (account === this.bankAccount) {
          throw new ValidationError(
            t`Line ${row}: cannot post to the batch's own bank account.`
          );
        }
      } else if (!line.get('party')) {
        throw new ValidationError(
          t`Line ${row}: choose a ${lineType.toLowerCase()}.`
        );
      }
    });
  }

  /**
   * Pastel-style: an unfinished batch can always be saved as a draft.
   * All checks (lines, balance, closed periods) run when it is updated.
   */
  async validate() {
    if (!this.submitted) {
      return;
    }

    this.validateLines();
    await super.validate();
  }

  async getPosting() {
    const posting = new BatchPosting(this, this.fyo);
    const zero = this.fyo.pesa(0);
    const bank = this.bankAccount!;
    const isReceipt = this.batchType === 'Receipts';
    const vatEnabled = !!this.fyo.singles.AccountingSettings?.vatRegistered;

    for (const line of this.lines ?? []) {
      const amount = (line.get('amount') as Money | undefined) ?? zero;
      if (amount.isZero()) {
        continue;
      }

      const date = (line.get('date') as Date | undefined) ?? this.date!;
      const lineType = (line.get('lineType') as LineType) ?? 'GL';

      let target: string;
      let party: string | undefined;
      let vat = zero;
      let vatAccount: string | null = null;

      if (lineType === 'GL') {
        target = line.get('account') as string;
        const tax = line.get('tax') as string | undefined;
        if (tax && vatEnabled) {
          const info = await getTaxInfo(this.fyo, tax);
          if (info && info.rate > 0) {
            vat = calcVatInclusive(this.fyo, amount, info.rate);
            vatAccount = info.account;
          }
        }
      } else {
        party = line.get('party') as string;
        target = await getControlAccount(this.fyo, lineType);
      }

      const net = amount.sub(vat);

      if (isReceipt) {
        posting.addEntry(bank, { date, debit: amount });
        posting.addEntry(target, { date, credit: net, party });
        if (vatAccount && !vat.isZero()) {
          posting.addEntry(vatAccount, { date, credit: vat });
        }
      } else {
        posting.addEntry(target, { date, debit: net, party });
        if (vatAccount && !vat.isZero()) {
          posting.addEntry(vatAccount, { date, debit: vat });
        }
        posting.addEntry(bank, { date, credit: amount });
      }
    }

    return posting;
  }

  override async validatePeriodLock(): Promise<void> {
    if (!this.submitted) {
      return;
    }

    let wasSubmitted = false;
    let wasCancelled = false;

    if (this.name && (await this.fyo.db.exists(this.schemaName, this.name))) {
      const prev = (await this.fyo.db.get(this.schemaName, this.name, [
        'submitted',
        'cancelled',
      ])) as { submitted?: unknown; cancelled?: unknown };

      wasSubmitted = !!prev.submitted;
      wasCancelled = !!prev.cancelled;
    }

    try {
      if (!wasSubmitted) {
        for (const line of this.lines ?? []) {
          const date = (line.get('date') as Date | undefined) ?? this.date;
          await assertPeriodOpen(this.fyo, date, t`Posting`);
        }
      } else if (this.cancelled && !wasCancelled) {
        await assertPeriodOpen(this.fyo, new Date(), t`Reversing`);
      }
    } catch (err) {
      if (!wasSubmitted) {
        this.submitted = false;
      } else {
        this.cancelled = false;
      }
      throw err;
    }
  }

  static defaults: DefaultMap = {
    batchType: () => 'Payments',
    date: () => new Date(),
  };

  static filters: FiltersMap = {
    bankAccount: () => ({
      isGroup: false,
      accountType: ['in', ['Bank', 'Cash']],
    }),
  };

  static getActions(fyo: Fyo): Action[] {
    return [getLedgerLinkAction(fyo)];
  }

  static getListViewSettings(): ListViewSettings {
    return {
      columns: [
        'name',
        {
          label: t`Status`,
          fieldname: 'status',
          fieldtype: 'Select',
          render(doc) {
            const status = getDocStatus(doc);
            const color = statusColor[status] ?? 'gray';
            const label = getStatusText(status);

            return {
              template: `<Badge class="text-xs" color="${color}">${label}</Badge>`,
            };
          },
        },
        'batchType',
        'bankAccount',
        'date',
        'totalAmount',
      ],
    };
  }
}
