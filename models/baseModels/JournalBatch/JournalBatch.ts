import { Fyo, t } from 'fyo';
import { Doc } from 'fyo/model/doc';
import {
  Action,
  DefaultMap,
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
} from '../CashbookBatch/batchHelpers';

type JournalType = 'General' | 'Customer' | 'Supplier';

/**
 * Pastel-style journal batch (General / Customer / Supplier).
 *
 * Each line is a Debit OR a Credit (VAT-inclusive), with Type GL /
 * Customer / Supplier and one Account box (Pastel style).
 * - General, GL line: line account gets net + VAT on the line's side.
 * - General, Customer/Supplier line: control account (with party) gets the
 *   full amount, no VAT.
 *   With a contra account, the contra gets the full amount on the
 *   opposite side (line balances itself). Without contra, the batch
 *   as a whole must balance.
 * - Customer / Supplier: the debtors/creditors control account (with the
 *   party) gets the full amount on the line's side; the contra GL account
 *   (required) gets net + VAT on the opposite side.
 */
export class JournalBatch extends Transactional {
  batchType?: JournalType;
  lines?: Doc[];
  totalDebit?: Money;
  totalCredit?: Money;

  sumLines(field: string): Money {
    return (this.lines ?? []).reduce((acc, line) => {
      const value = line.get(field) as Money | undefined;
      return value ? acc.add(value) : acc;
    }, this.fyo.pesa(0));
  }

  formulas: FormulaMap = {
    totalDebit: { formula: () => this.sumLines('debit') },
    totalCredit: { formula: () => this.sumLines('credit') },
  };

  validateLines(): void {
    const lines = this.lines ?? [];
    if (!lines.length) {
      throw new ValidationError(t`Add at least one line.`);
    }

    const type = this.batchType ?? 'General';
    const zero = this.fyo.pesa(0);

    lines.forEach((line, i) => {
      const row = i + 1;
      const debit = (line.get('debit') as Money | undefined) ?? zero;
      const credit = (line.get('credit') as Money | undefined) ?? zero;

      if (debit.lt(0) || credit.lt(0)) {
        throw new ValidationError(t`Line ${row}: amounts cannot be negative.`);
      }

      if (debit.isZero() === credit.isZero()) {
        throw new ValidationError(
          t`Line ${row}: enter either a debit or a credit, not both.`
        );
      }

      const lineType = (line.get('lineType') as LineType) ?? 'GL';
      const contra = line.get('contraAccount') as string | undefined;

      if (lineType === 'GL') {
        const account = line.get('account') as string | undefined;
        if (!account) {
          throw new ValidationError(t`Line ${row}: choose a GL account.`);
        }

        if (contra && contra === account) {
          throw new ValidationError(
            t`Line ${row}: contra account cannot be the same as the account.`
          );
        }
      } else if (!line.get('party')) {
        throw new ValidationError(
          t`Line ${row}: choose a ${lineType.toLowerCase()}.`
        );
      }

      if (type !== 'General' && !contra) {
        throw new ValidationError(
          t`Line ${row}: choose a contra GL account.`
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
    const type = this.batchType ?? 'General';
    const vatEnabled = !!this.fyo.singles.AccountingSettings?.vatRegistered;

    for (const line of this.lines ?? []) {
      const debit = (line.get('debit') as Money | undefined) ?? zero;
      const credit = (line.get('credit') as Money | undefined) ?? zero;
      const isDebit = !debit.isZero();
      const amount = isDebit ? debit : credit;
      if (amount.isZero()) {
        continue;
      }

      const date = (line.get('date') as Date | undefined) ?? this.date!;
      const contra = line.get('contraAccount') as string | undefined;
      const tax = line.get('tax') as string | undefined;

      let vat = zero;
      let vatAccount: string | null = null;
      const lineType = (line.get('lineType') as LineType) ?? 'GL';
      const vatAllowed =
        type === 'General' ? lineType === 'GL' : !!contra;
      if (vatEnabled && tax && vatAllowed) {
        const info = await getTaxInfo(this.fyo, tax);
        if (info && info.rate > 0) {
          vat = calcVatInclusive(this.fyo, amount, info.rate);
          vatAccount = info.account;
        }
      }

      const net = amount.sub(vat);

      const onSide = (account: string, value: Money, party?: string) =>
        posting.addEntry(account, {
          date,
          party,
          ...(isDebit ? { debit: value } : { credit: value }),
        });

      const onOpposite = (account: string, value: Money) =>
        posting.addEntry(account, {
          date,
          ...(isDebit ? { credit: value } : { debit: value }),
        });

      if (type === 'General' && lineType === 'GL') {
        const account = line.get('account') as string;
        onSide(account, net);
        if (vatAccount && !vat.isZero()) {
          onSide(vatAccount, vat);
        }

        if (contra) {
          onOpposite(contra, amount);
        }
      } else if (type === 'General') {
        // Customer / Supplier line in a General Journal: no VAT.
        const party = line.get('party') as string;
        const control = await getControlAccount(this.fyo, lineType);
        onSide(control, amount, party);
        if (contra) {
          onOpposite(contra, amount);
        }
      } else {
        const party = line.get('party') as string;
        const control = await getControlAccount(this.fyo, type);
        onSide(control, amount, party);
        onOpposite(contra!, net);
        if (vatAccount && !vat.isZero()) {
          onOpposite(vatAccount, vat);
        }
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
    batchType: () => 'General',
    date: () => new Date(),
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
        'date',
        'totalDebit',
        'totalCredit',
      ],
    };
  }
}
