import { Fyo } from 'fyo';
import { Doc } from 'fyo/model/doc';
import {
  Action,
  FiltersMap,
  FormulaMap,
  ListViewSettings,
  ValidationMap,
} from 'fyo/model/types';
import {
  validateEmail,
  validatePhoneNumber,
} from 'fyo/model/validationFunction';
import { DocValue } from 'fyo/core/types';
import { ValidationError } from 'fyo/utils/errors';
import { Money } from 'pesa';
import { PartyRole } from './types';
import { ModelNameEnum } from 'models/types';
import { isLoyaltyProgramExpiredAndMaxed } from 'models/helpers';

const CODE_PATTERN = /^[A-Z]{3}\d{3}$/;

// "Smith Plumbing" -> "SMI", "A1 Tyres" -> "ATY", "Jo" -> "JOX"
function codePrefix(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .padEnd(3, 'X')
    .slice(0, 3);
}

export async function suggestPartyCode(
  fyo: Fyo,
  name: string,
  selfName?: string
): Promise<string> {
  const prefix = codePrefix(name);
  const rows = (await fyo.db.getAll(ModelNameEnum.Party, {
    fields: ['name', 'code'],
  })) as { name: string; code?: string | null }[];

  let max = 0;
  for (const row of rows) {
    if (row.name === selfName || !row.code) {
      continue;
    }

    const code = String(row.code).toUpperCase();
    if (!code.startsWith(prefix)) {
      continue;
    }

    const n = Number(code.slice(3));
    if (!Number.isNaN(n) && n > max) {
      max = n;
    }
  }

  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export class Party extends Doc {
  role?: PartyRole;
  party?: string;
  code?: string;
  fromLead?: string;
  defaultAccount?: string;
  loyaltyPoints?: number;
  outstandingAmount?: Money;
  async updateOutstandingAmount() {
    /**
     * If Role === "Both" then outstanding Amount
     * will be the amount to be paid to the party.
     */

    const role = this.role as PartyRole;
    let outstandingAmount = this.fyo.pesa(0);

    if (role === 'Customer' || role === 'Both') {
      const outstandingReceive = await this._getTotalOutstandingAmount(
        'SalesInvoice'
      );
      outstandingAmount = outstandingAmount.add(outstandingReceive);
    }

    if (role === 'Supplier') {
      const outstandingPay = await this._getTotalOutstandingAmount(
        'PurchaseInvoice'
      );
      outstandingAmount = outstandingAmount.add(outstandingPay);
    }

    if (role === 'Both') {
      const outstandingPay = await this._getTotalOutstandingAmount(
        'PurchaseInvoice'
      );
      outstandingAmount = outstandingAmount.sub(outstandingPay);
    }

    await this.setAndSync({ outstandingAmount });
  }

  async updateLoyaltyPoints() {
    let loyaltyPoints = 0;

    if (this.role === 'Customer' || this.role === 'Both') {
      loyaltyPoints = await this._getTotalLoyaltyPoints();
    }

    await this.setAndSync({ loyaltyPoints });
  }

  async _getTotalLoyaltyPoints() {
    const loyaltyProgramName = this.loyaltyProgram as string;
    if (loyaltyProgramName) {
      const isExpiredAndMaxed = await isLoyaltyProgramExpiredAndMaxed(
        this.fyo,
        loyaltyProgramName
      );
      if (isExpiredAndMaxed) {
        return 0;
      }
    }

    const data = (await this.fyo.db.getAll(ModelNameEnum.LoyaltyPointEntry, {
      fields: ['name', 'loyaltyPoints', 'expiryDate', 'postingDate'],
      filters: {
        customer: this.name as string,
      },
    })) as {
      name: string;
      loyaltyPoints: number;
      expiryDate: Date;
      postingDate: Date;
    }[];

    const totalLoyaltyPoints = data.reduce((total, entry) => {
      if (entry.expiryDate > entry.postingDate) {
        return total + entry.loyaltyPoints;
      }

      return total;
    }, 0);

    return totalLoyaltyPoints;
  }

  async _getTotalOutstandingAmount(
    schemaName: 'SalesInvoice' | 'PurchaseInvoice'
  ) {
    const outstandingAmounts = await this.fyo.db.getAllRaw(schemaName, {
      fields: ['outstandingAmount'],
      filters: {
        submitted: true,
        cancelled: false,
        party: this.name as string,
      },
    });

    return outstandingAmounts
      .map(({ outstandingAmount }) =>
        this.fyo.pesa(outstandingAmount as number)
      )
      .reduce((a, b) => a.add(b), this.fyo.pesa(0));
  }

  formulas: FormulaMap = {
    // SA: pick the debtors/creditors control account by account type,
    // so it works with numbered charts (8000/000, 9000/000).
    defaultAccount: {
      formula: async () => {
        const role = this.role as PartyRole;
        if (role === 'Both') {
          return '';
        }

        const accountType = role === 'Supplier' ? 'Payable' : 'Receivable';
        const rows = (await this.fyo.db.getAll('Account', {
          fields: ['name', 'isGroup'],
          filters: { accountType },
        })) as { name: string; isGroup?: boolean | number }[];

        const leaf = rows.find((r) => !r.isGroup);
        return leaf?.name ?? '';
      },
      dependsOn: ['role'],
    },
    // SA: suggest a Pastel-style code (ABC001) from the name.
    code: {
      formula: async () => {
        if (this.code || !this.name) {
          return;
        }

        return await suggestPartyCode(
          this.fyo,
          this.name,
          this.notInserted ? undefined : this.name
        );
      },
      dependsOn: ['name'],
    },
    currency: {
      formula: () => {
        if (!this.currency) {
          return this.fyo.singles.SystemSettings!.currency as string;
        }
      },
    },
  };

  validations: ValidationMap = {
    email: validateEmail,
    phone: validatePhoneNumber,
    taxId: (value: DocValue) => {
      if (!value) {
        return;
      }
      if (!/^4\d{9}$/.test(String(value).trim())) {
        throw new ValidationError(
          this.fyo.t`VAT number must be 10 digits starting with 4.`
        );
      }
    },
    code: async (value: DocValue) => {
      if (!value) {
        return;
      }

      const code = String(value).trim().toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        throw new ValidationError(
          this.fyo.t`Account code must be 3 letters and 3 numbers, e.g. ABC001.`
        );
      }

      const rows = (await this.fyo.db.getAll(ModelNameEnum.Party, {
        fields: ['name', 'code'],
      })) as { name: string; code?: string | null }[];

      const clash = rows.find(
        (r) =>
          r.name !== this.name &&
          !!r.code &&
          String(r.code).toUpperCase() === code
      );

      if (clash) {
        throw new ValidationError(
          this.fyo.t`Account code ${code} is already used by ${clash.name}.`
        );
      }
    },
  };

  async beforeSync() {
    await super.beforeSync();
    if (this.code) {
      this.code = String(this.code).trim().toUpperCase();
    }
  }

  static filters: FiltersMap = {
    defaultAccount: (doc: Doc) => {
      const role = doc.role as PartyRole;
      if (role === 'Both') {
        return {
          isGroup: false,
          accountType: ['in', ['Payable', 'Receivable']],
        };
      }

      return {
        isGroup: false,
        accountType: role === 'Customer' ? 'Receivable' : 'Payable',
      };
    },
  };

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['code', 'name', 'email', 'phone', 'outstandingAmount'],
    };
  }

  async afterDelete() {
    await super.afterDelete();
    if (!this.fromLead) {
      return;
    }
    const leadData = await this.fyo.doc.getDoc(ModelNameEnum.Lead, this.name);
    await leadData.setAndSync('status', 'Interested');
  }

  async afterSync() {
    await super.afterSync();
    if (!this.fromLead) {
      return;
    }

    const leadData = await this.fyo.doc.getDoc(ModelNameEnum.Lead, this.name);
    await leadData.setAndSync('status', 'Converted');
  }

  static getActions(fyo: Fyo): Action[] {
    return [
      {
        label: fyo.t`Create Purchase`,
        condition: (doc: Doc) =>
          !doc.notInserted && (doc.role as PartyRole) !== 'Customer',
        action: async (partyDoc, router) => {
          const doc = fyo.doc.getNewDoc('PurchaseInvoice', {
            party: partyDoc.name,
            account: partyDoc.defaultAccount as string,
          });

          await router.push({
            path: `/edit/PurchaseInvoice/${doc.name!}`,
            query: {
              schemaName: 'PurchaseInvoice',
              values: {
                // @ts-ignore
                party: partyDoc.name!,
              },
            },
          });
        },
      },
      {
        label: fyo.t`View Purchases`,
        condition: (doc: Doc) =>
          !doc.notInserted && (doc.role as PartyRole) !== 'Customer',
        action: async (partyDoc, router) => {
          await router.push({
            path: '/list/PurchaseInvoice',
            query: { filters: JSON.stringify({ party: partyDoc.name }) },
          });
        },
      },
      {
        label: fyo.t`Create Sale`,
        condition: (doc: Doc) =>
          !doc.notInserted && (doc.role as PartyRole) !== 'Supplier',
        action: async (partyDoc, router) => {
          const doc = fyo.doc.getNewDoc('SalesInvoice', {
            party: partyDoc.name,
            account: partyDoc.defaultAccount as string,
          });

          await router.push({
            path: `/edit/SalesInvoice/${doc.name!}`,
            query: {
              schemaName: 'SalesInvoice',
              values: {
                // @ts-ignore
                party: partyDoc.name!,
              },
            },
          });
        },
      },
      {
        label: fyo.t`View Sales`,
        condition: (doc: Doc) =>
          !doc.notInserted && (doc.role as PartyRole) !== 'Supplier',
        action: async (partyDoc, router) => {
          await router.push({
            path: '/list/SalesInvoice',
            query: { filters: JSON.stringify({ party: partyDoc.name }) },
          });
        },
      },
    ];
  }
}
