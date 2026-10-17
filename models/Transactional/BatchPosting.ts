import { AccountingLedgerEntry } from 'models/baseModels/AccountingLedgerEntry/AccountingLedgerEntry';
import { ModelNameEnum } from 'models/types';
import { Money } from 'pesa';
import { LedgerPosting } from './LedgerPosting';

/**
 * LedgerPosting variant for batches: one ledger entry per call, each with
 * its own date and party (Pastel-style batch lines).
 */
export class BatchPosting extends LedgerPosting {
  addEntry(
    account: string,
    opts: { date: Date | string; debit?: Money; credit?: Money; party?: string }
  ): void {
    const zero = this.fyo.pesa(0);
    const debit = opts.debit ?? zero;
    const credit = opts.credit ?? zero;

    if (debit.isZero() && credit.isZero()) {
      return;
    }

    const entry = this.fyo.doc.getNewDoc(
      ModelNameEnum.AccountingLedgerEntry,
      {
        account,
        party: opts.party ?? '',
        date: this.timezoneDateTimeAdjuster(opts.date),
        referenceType: this.refDoc.schemaName,
        referenceName: this.refDoc.name!,
        reverted: false,
        debit,
        credit,
      },
      false
    ) as AccountingLedgerEntry;

    this.entries.push(entry);
  }
}