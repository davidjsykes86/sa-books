import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';

export type VatType = 'STD' | 'ZERO' | 'EXPORT' | 'EXEMPT' | 'CAPITAL';

// Pastel-style short tax codes typed in batch entry.
export const DEFAULT_TAX_CODES: Record<VatType, string> = {
  STD: '15',
  ZERO: '01',
  EXPORT: '02',
  EXEMPT: '03',
  CAPITAL: '14',
};

export class Tax extends Doc {
  code?: string;
  vatType?: VatType;

  static getListViewSettings(): ListViewSettings {
    return { columns: ['code', 'name', 'vatType'] };
  }
}
