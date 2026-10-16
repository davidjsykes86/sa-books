import { Doc } from 'fyo/model/doc';
import {
  ChangeArg,
  FiltersMap,
  HiddenMap,
  ListsMap,
  ReadOnlyMap,
  ValidationMap,
} from 'fyo/model/types';
import { validateEmail } from 'fyo/model/validationFunction';
import { DocValue } from 'fyo/core/types';
import { ValidationError } from 'fyo/utils/errors';
import { InventorySettings } from 'models/inventory/InventorySettings';
import { ModelNameEnum } from 'models/types';
import { createDiscountAccount } from 'src/setup/setupInstance';
import { getCountryInfo } from 'utils/misc';
import { setupSAVat } from './saVatSetup';

export class AccountingSettings extends Doc {
  enableDiscounting?: boolean;
  enableInventory?: boolean;
  enablePriceList?: boolean;
  enableLead?: boolean;
  enableCouponCode?: boolean;
  enableFormCustomization?: boolean;
  enableInvoiceReturns?: boolean;
  enableLoyaltyProgram?: boolean;
  enablePricingRule?: boolean;
  enaenableItemEnquiry?: boolean;
  enableERPNextSync?: boolean;
  enablePointOfSaleWithOutInventory?: boolean;
  enablePartialPayment?: boolean;
  enableitemGroup?: boolean;

  // South Africa
  companyRegNo?: string;
  vatRegistered?: boolean;
  vatNumber?: string;
  vatRegistrationDate?: Date;
  vatCategory?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  vatBasis?: 'Invoice' | 'Payments';

  get isSouthAfrica(): boolean {
    return this.fyo.singles.SystemSettings?.countryCode === 'za';
  }

  static filters: FiltersMap = {
    writeOffAccount: () => ({
      isGroup: false,
      rootType: 'Expense',
    }),
    roundOffAccount: () => ({
      isGroup: false,
      rootType: 'Expense',
    }),
    discountAccount: () => ({
      isGroup: false,
      rootType: 'Income',
    }),
  };

  validations: ValidationMap = {
    email: validateEmail,
    vatNumber: (value: DocValue) => {
      if (!value) {
        return;
      }
      const v = String(value).trim();
      if (!/^4\d{9}$/.test(v)) {
        throw new ValidationError(
          this.fyo.t`VAT number must be 10 digits starting with 4.`
        );
      }
    },
    companyRegNo: (value: DocValue) => {
      if (!value) {
        return;
      }
      const v = String(value).trim();
      if (!/^\d{4}\/\d{6}\/\d{2}$/.test(v)) {
        throw new ValidationError(
          this.fyo.t`Registration number must look like 2026/123456/07.`
        );
      }
    },
  };

  static lists: ListsMap = {
    country: () => Object.keys(getCountryInfo()),
  };

  readOnly: ReadOnlyMap = {
    enableDiscounting: () => {
      return !!this.enableDiscounting;
    },
    enableInventory: () => {
      return !!this.enableInventory;
    },
    enableLead: () => {
      return !!this.enableLead;
    },
    enableERPNextSync: () => {
      return !!this.enableERPNextSync;
    },
    enableInvoiceReturns: () => {
      return !!this.enableInvoiceReturns;
    },
    enableLoyaltyProgram: () => {
      return !!this.enableLoyaltyProgram;
    },
    enablePointOfSaleWithOutInventory: () => {
      return !!this.enablePointOfSaleWithOutInventory;
    },
    enableitemGroup: () => {
      return !!this.enableitemGroup;
    },
  };

  override hidden: HiddenMap = {
    discountAccount: () => !this.enableDiscounting,
    gstin: () => this.fyo.singles.SystemSettings?.countryCode !== 'in',
    enablePricingRule: () =>
      !this.fyo.singles.AccountingSettings?.enableDiscounting,
    enableCouponCode: () =>
      !this.fyo.singles.AccountingSettings?.enablePricingRule,

    // South Africa
    companyRegNo: () => !this.isSouthAfrica,
    vatRegistered: () => !this.isSouthAfrica,
    vatNumber: () => !this.isSouthAfrica || !this.vatRegistered,
    vatRegistrationDate: () => !this.isSouthAfrica || !this.vatRegistered,
    vatCategory: () => !this.isSouthAfrica || !this.vatRegistered,
    vatBasis: () => !this.isSouthAfrica || !this.vatRegistered,
  };

  async change(ch: ChangeArg) {
    if (
      ch.changed === 'vatRegistered' &&
      this.vatRegistered &&
      this.isSouthAfrica
    ) {
      await setupSAVat(this.fyo);
    }

    const discountingEnabled =
      ch.changed === 'enableDiscounting' && this.enableDiscounting;
    const discountAccountNotSet = !this.discountAccount;

    if (discountingEnabled && discountAccountNotSet) {
      await createDiscountAccount(this.fyo);
    }

    if (
      ch.changed == 'enablePointOfSaleWithOutInventory' &&
      this.enablePointOfSaleWithOutInventory
    ) {
      const inventorySettings = (await this.fyo.doc.getDoc(
        ModelNameEnum.InventorySettings
      )) as InventorySettings;

      await inventorySettings.set('enableBatches', true);
      await inventorySettings.set('enableUomConversions', true);
      await inventorySettings.set('enableSerialNumber', true);
      await inventorySettings.set('enableBarcodes', true);
      await inventorySettings.set('enablePointOfSale', true);

      await inventorySettings.sync();
    }
  }
}