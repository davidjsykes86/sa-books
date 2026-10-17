import { Doc } from 'fyo/model/doc';
import { ListViewSettings } from 'fyo/model/types';

export class AccountingPeriod extends Doc {
  fiscalYear?: string;
  periodNumber?: number;
  startDate?: Date;
  endDate?: Date;
  closed?: boolean;

  static getListViewSettings(): ListViewSettings {
    return { columns: ['name', 'startDate', 'endDate', 'closed'] };
  }
}