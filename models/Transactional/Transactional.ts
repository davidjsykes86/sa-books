import { t } from 'fyo';
import { Doc } from 'fyo/model/doc';
import { assertPeriodOpen } from 'models/baseModels/AccountingPeriod/periods';
import { ModelNameEnum } from 'models/types';
import { LedgerPosting } from './LedgerPosting';

/**
 * # Transactional
 *
 * Any model that creates ledger entries on submit should extend the
 * `Transactional` model.
 *
 * Example of transactional models:
 * - Invoice
 * - Payment
 * - JournalEntry
 *
 * Basically it does the following:
 * - `afterSubmit`: create the ledger entries.
 * - `afterCancel`: create reverse ledger entries.
 * - `afterDelete`: delete the normal and reversed ledger entries.
 *
 * SA: posting or reversing into a closed AccountingPeriod is blocked.
 */

export abstract class Transactional extends Doc {
  date?: Date;

  get isTransactional() {
    return true;
  }

  abstract getPosting(): Promise<LedgerPosting | null>;

  async validate() {
    await super.validate();
    if (!this.isTransactional) {
      return;
    }

    await this.validatePeriodLock();

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    posting.validate();
  }

  /**
   * Only checks at the moment of posting (draft -> submitted) or
   * reversing (submitted -> cancelled), so routine re-saves of posted
   * documents (e.g. outstanding amount updates) are not blocked.
   *
   * If blocked, the in-memory submitted/cancelled flag is reset so the
   * form keeps showing the correct buttons.
   */
  async validatePeriodLock(): Promise<void> {
    if (!this.submitted || !this.date) {
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

    if (!wasSubmitted) {
      try {
        await assertPeriodOpen(this.fyo, this.date, t`Posting`);
      } catch (err) {
        this.submitted = false;
        throw err;
      }
      return;
    }

    if (this.cancelled && !wasCancelled) {
      try {
        await assertPeriodOpen(this.fyo, this.date, t`Reversing`);
      } catch (err) {
        this.cancelled = false;
        throw err;
      }
    }
  }

  async afterSubmit(): Promise<void> {
    await super.afterSubmit();
    if (!this.isTransactional) {
      return;
    }

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    await posting.post();
  }

  async afterCancel(): Promise<void> {
    await super.afterCancel();
    if (!this.isTransactional) {
      return;
    }

    const posting = await this.getPosting();
    if (posting === null) {
      return;
    }

    await posting.postReverse();
  }

  async afterDelete(): Promise<void> {
    await super.afterDelete();
    if (!this.isTransactional) {
      return;
    }

    const ledgerEntryIds = (await this.fyo.db.getAll(
      ModelNameEnum.AccountingLedgerEntry,
      {
        fields: ['name'],
        filters: {
          referenceType: this.schemaName,
          referenceName: this.name!,
        },
      }
    )) as { name: string }[];

    for (const { name } of ledgerEntryIds) {
      const ledgerEntryDoc = await this.fyo.doc.getDoc(
        ModelNameEnum.AccountingLedgerEntry,
        name
      );
      await ledgerEntryDoc.delete();
    }
  }
}