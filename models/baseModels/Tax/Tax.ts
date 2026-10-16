import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';

export type VatType = 'STD' | 'ZERO' | 'EXPORT' | 'EXEMPT' | 'CAPITAL';

export class Tax extends Doc {
  vatType?: VatType;

  static getListViewSettings(): ListViewSettings {
    return { columns: ['name', 'vatType'] };
  }
}
