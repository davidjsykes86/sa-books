import { Fyo } from 'fyo';
import { ModelNameEnum } from 'models/types';

export const SA_VAT_ACCOUNT = 'VAT Control';
const SA_VAT_PARENT = 'Duties and Taxes';

const SA_VAT_TEMPLATES: { name: string; vatType: string; rate: number }[] = [
  { name: 'VAT 15% Standard', vatType: 'STD', rate: 15 },
  { name: 'VAT 0% Zero-rated', vatType: 'ZERO', rate: 0 },
  { name: 'VAT 0% Export', vatType: 'EXPORT', rate: 0 },
  { name: 'VAT Exempt', vatType: 'EXEMPT', rate: 0 },
  { name: 'VAT 15% Capital Goods', vatType: 'CAPITAL', rate: 15 },
];

export async function setupSAVat(fyo: Fyo): Promise<void> {
  const accountExists = await fyo.db.exists(
    ModelNameEnum.Account,
    SA_VAT_ACCOUNT
  );

  if (!accountExists) {
    const account = fyo.doc.getNewDoc(ModelNameEnum.Account, {
      name: SA_VAT_ACCOUNT,
      rootType: 'Liability',
      parentAccount: SA_VAT_PARENT,
      accountType: 'Tax',
      isGroup: false,
    });
    await account.sync();
  }

  for (const t of SA_VAT_TEMPLATES) {
    const exists = await fyo.db.exists(ModelNameEnum.Tax, t.name);
    if (exists) {
      continue;
    }

    const tax = fyo.doc.getNewDoc(ModelNameEnum.Tax, {
      name: t.name,
      vatType: t.vatType,
      details: [{ account: SA_VAT_ACCOUNT, rate: t.rate }],
    });
    await tax.sync();
  }
}