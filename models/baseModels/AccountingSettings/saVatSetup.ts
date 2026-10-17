import { Fyo } from 'fyo';
import { ModelNameEnum } from 'models/types';

const FALLBACK_VAT_ACCOUNT = 'VAT Control';
const FALLBACK_VAT_PARENT = 'Duties and Taxes';

const SA_VAT_TEMPLATES: {
  name: string;
  code: string;
  vatType: string;
  rate: number;
}[] = [
  { name: 'VAT 15% Standard', code: '15', vatType: 'STD', rate: 15 },
  { name: 'VAT 0% Zero-rated', code: '01', vatType: 'ZERO', rate: 0 },
  { name: 'VAT 0% Export', code: '02', vatType: 'EXPORT', rate: 0 },
  { name: 'VAT Exempt', code: '03', vatType: 'EXEMPT', rate: 0 },
  { name: 'VAT 15% Capital Goods', code: '14', vatType: 'CAPITAL', rate: 15 },
];

async function getVatAccount(fyo: Fyo): Promise<string> {
  const taxAccounts = (await fyo.db.getAll(ModelNameEnum.Account, {
    fields: ['name', 'isGroup'],
    filters: { accountType: 'Tax' },
  })) as { name: string; isGroup?: boolean | number }[];

  const leaves = taxAccounts.filter((a) => !a.isGroup);
  const preferred =
    leaves.find((a) => a.name.startsWith('9500/000')) ??
    leaves.find((a) => a.name === FALLBACK_VAT_ACCOUNT) ??
    leaves[0];

  if (preferred) {
    return preferred.name;
  }

  const parentExists = await fyo.db.exists(
    ModelNameEnum.Account,
    FALLBACK_VAT_PARENT
  );
  if (!parentExists) {
    throw new Error(
      'No VAT account found. Create a Tax-type account (e.g. 9500/000 Vat Control) first.'
    );
  }

  const account = fyo.doc.getNewDoc(ModelNameEnum.Account, {
    name: FALLBACK_VAT_ACCOUNT,
    rootType: 'Liability',
    parentAccount: FALLBACK_VAT_PARENT,
    accountType: 'Tax',
    isGroup: false,
  });
  await account.sync();
  return FALLBACK_VAT_ACCOUNT;
}

export async function setupSAVat(fyo: Fyo): Promise<void> {
  const vatAccount = await getVatAccount(fyo);

  for (const t of SA_VAT_TEMPLATES) {
    const exists = await fyo.db.exists(ModelNameEnum.Tax, t.name);
    if (exists) {
      // Backfill the short tax code on templates created before codes existed.
      const doc = await fyo.doc.getDoc(ModelNameEnum.Tax, t.name);
      if (!doc.get('code')) {
        await doc.setAndSync('code', t.code);
      }
      continue;
    }

    const tax = fyo.doc.getNewDoc(ModelNameEnum.Tax, {
      name: t.name,
      code: t.code,
      vatType: t.vatType,
      details: [{ account: vatAccount, rate: t.rate }],
    });
    await tax.sync();
  }
}
