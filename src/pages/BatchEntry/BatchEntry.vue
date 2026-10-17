<template>
  <div
    class="flex flex-col h-full w-full text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-890"
    @keydown.capture="onGlobalKey"
  >
    <!-- Title bar -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b dark:border-gray-800 font-semibold"
    >
      <span>{{ isCashbook ? 'Process Cash Books' : 'Process Journals' }}</span>
      <span v-if="doc && !doc.notInserted" class="text-xs text-gray-500">
        Batch {{ doc.name }} (draft)
      </span>
    </div>

    <!-- Header -->
    <div class="flex items-center gap-4 px-4 py-2 border-b dark:border-gray-800">
      <template v-if="isCashbook">
        <label class="text-gray-600 dark:text-gray-400">Cash Book</label>
        <select
          :value="bankAccount"
          class="border dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800 min-w-64"
          tabindex="-1"
          @change="changeBank($event)"
        >
          <option v-for="(b, i) in bankAccounts" :key="b.name" :value="b.name">
            {{ String(i + 1).padStart(2, '0') }} - {{ b.name }}
          </option>
        </select>
        <div class="ms-auto flex items-center gap-2">
          <label class="text-gray-600 dark:text-gray-400">Balance</label>
          <span
            class="border dark:border-gray-700 rounded px-3 py-1 min-w-32 text-right bg-gray-50 dark:bg-gray-800"
            >{{ balanceText }}</span
          >
        </div>
      </template>

      <template v-else>
        <label class="text-gray-600 dark:text-gray-400">Entry Type</label>
        <select
          :value="entryType"
          class="border dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800"
          tabindex="-1"
          @change="changeEntryType($event)"
        >
          <option value="General">General Journal</option>
          <option value="Customer">Customer Journal</option>
          <option value="Supplier">Supplier Journal</option>
        </select>
        <label class="text-gray-600 dark:text-gray-400 ms-4">Batch Type</label>
        <select
          class="border dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800"
          tabindex="-1"
          disabled
        >
          <option>Normal batch entry</option>
        </select>
        <div class="ms-auto" />
      </template>

      <button
        class="border dark:border-gray-700 rounded px-4 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
        tabindex="-1"
        :title="showSidebar ? 'Hide the left menu for more room' : 'Show the left menu'"
        @click="toggleMenu"
      >
        {{ showSidebar ? 'Hide Menu' : 'Show Menu' }}
      </button>
      <button
        class="border dark:border-gray-700 rounded px-4 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
        tabindex="-1"
        @click="close"
      >
        Close
      </button>
    </div>

    <!-- Payments / Receipts tabs -->
    <div v-if="isCashbook" class="flex">
      <button
        class="flex-1 py-1 font-semibold border-b-2"
        :class="
          tab === 'Payments'
            ? 'bg-amber-100 dark:bg-amber-900 border-amber-500'
            : 'bg-gray-100 dark:bg-gray-800 border-transparent text-gray-500'
        "
        tabindex="-1"
        @click="setTab('Payments')"
      >
        Payments
      </button>
      <button
        class="flex-1 py-1 font-semibold border-b-2"
        :class="
          tab === 'Receipts'
            ? 'bg-sky-100 dark:bg-sky-900 border-sky-500'
            : 'bg-gray-100 dark:bg-gray-800 border-transparent text-gray-500'
        "
        tabindex="-1"
        @click="setTab('Receipts')"
      >
        Receipts
      </button>
    </div>

    <!-- Grid -->
    <div class="flex-1 overflow-auto" :class="gridTint" @scroll="dropdown.open = false">
      <table class="w-full border-collapse table-fixed">
        <thead class="sticky top-0 bg-gray-100 dark:bg-gray-800 z-10">
          <tr>
            <th class="w-8 border dark:border-gray-700 px-1 font-semibold">#</th>
            <th
              v-for="col in columns"
              :key="col.key"
              class="border dark:border-gray-700 px-2 py-1 font-semibold"
              :class="[col.align === 'right' ? 'text-right' : 'text-left', col.width]"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, r) in rows"
            :key="row.id"
            :class="r === activeRow ? 'bg-blue-50 dark:bg-gray-800' : ''"
          >
            <td
              class="border dark:border-gray-700 px-1 text-center text-gray-500"
            >
              {{ r + 1 }}
            </td>
            <td
              v-for="col in columns"
              :key="col.key"
              class="border dark:border-gray-700 p-0"
              :class="cellClass(row, col)"
            >
              <span
                v-if="col.display"
                class="block px-2 py-1"
                :class="col.align === 'right' ? 'text-right' : ''"
                >{{ displayValue(row, col.key) }}</span
              >
              <input
                v-else
                type="text"
                class="w-full px-2 py-1 bg-transparent outline-none text-gray-900 dark:text-gray-100 focus:bg-blue-100 dark:focus:bg-gray-700"
                :class="col.align === 'right' ? 'text-right' : ''"
                :data-r="r"
                :data-c="col.key"
                :tabindex="isEditable(row, col.key) ? 0 : -1"
                :readonly="!isEditable(row, col.key)"
                :maxlength="maxLength(col.key)"
                :placeholder="col.key === 'date' ? 'dd/mm/yyyy' : ''"
                :value="cellText(row, col.key)"
                @click="openDropdown(r, col.key)"
                @input="onInput($event, row, col.key)"
                @focus="onFocus(r, col.key, row)"
                @blur="onBlur(row, col.key)"
                @keydown="onCellKey($event, r, col.key)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Buttons -->
    <div
      class="flex flex-wrap items-center gap-2 px-4 py-2 border-t dark:border-gray-800 bg-gray-50 dark:bg-gray-850"
    >
      <button :class="btn" tabindex="-1" @click="deleteRow(activeRow)">Delete &lt;Ctrl-D&gt;</button>
      <button :class="btn" tabindex="-1" @click="insertRow(activeRow)">Insert &lt;Ctrl-I&gt;</button>
      <button :class="btnOff" tabindex="-1" disabled>Match &lt;F3&gt;</button>
      <button v-if="isCashbook" :class="btnOff" tabindex="-1" disabled>Reconcile &lt;F7&gt;</button>
      <button :class="btn" tabindex="-1" @click="toggleIncExc">
        Inc/Exc &lt;F8&gt;: {{ inclusive ? 'Inclusive' : 'Exclusive' }}
      </button>
      <template v-if="isCashbook">
        <span class="ms-4 text-gray-600 dark:text-gray-400">Batch Total</span>
        <span class="border dark:border-gray-700 rounded px-3 py-1 min-w-32 text-right bg-white dark:bg-gray-800">{{ money(batchTotal) }}</span>
      </template>
      <div class="ms-auto flex gap-2 relative">
        <button :class="btn" tabindex="-1" @click="save(true)">Save &lt;Ctrl-S&gt;</button>
        <button :class="btn" tabindex="-1" @click="showUpdateMenu = !showUpdateMenu">Update...</button>
        <button :class="btn" tabindex="-1" @click="openBatchList">Batch...</button>
        <div
          v-if="showUpdateMenu"
          class="absolute bottom-10 right-16 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow-lg z-20 w-64"
        >
          <button class="block w-full text-left px-4 py-2 hover:bg-blue-100 dark:hover:bg-blue-900" tabindex="-1" @click="updateThis">
            Update this {{ isCashbook ? 'Cash Book' : 'Journal' }} Batch
          </button>
          <button class="block w-full text-left px-4 py-2 hover:bg-blue-100 dark:hover:bg-blue-900" tabindex="-1" @click="updateAll">
            Update all {{ isCashbook ? 'Cash Book' : 'Journal' }} Batches
          </button>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="flex items-center border-t dark:border-gray-800 text-xs">
      <span class="flex-1 px-3 py-1 truncate">{{ statusAccount }}</span>
      <span class="w-40 px-3 py-1 border-s dark:border-gray-800 text-red-600 font-semibold">{{ statusPeriod }}</span>
      <span class="w-48 px-3 py-1 border-s dark:border-gray-800 text-right font-semibold">{{ statusTotal }}</span>
    </div>

    <!-- Cell drop-down list -->
    <div
      v-if="dropdown.open && dropdownItems.length"
      class="fixed z-40 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded shadow-lg max-h-72 overflow-auto text-sm"
      :style="dropdown.style"
    >
      <div
        v-for="(item, i) in dropdownItems"
        :key="item.value"
        :ref="i === dropdown.index ? 'ddActive' : undefined"
        class="px-3 py-1 cursor-pointer flex gap-3 text-gray-900 dark:text-gray-100"
        :class="i === dropdown.index ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-800'"
        @mousedown.prevent="selectDropdown(item)"
      >
        <span class="font-mono min-w-16">{{ item.code }}</span>
        <span class="text-gray-600 dark:text-gray-300 truncate">{{ item.label }}</span>
      </div>
    </div>

    <!-- Zoom (Ctrl+Enter) -->
    <div
      v-if="zoom.open"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      @mousedown.self="closeZoom"
    >
      <div class="bg-white dark:bg-gray-900 rounded shadow-xl w-[36rem] max-h-[70vh] flex flex-col border dark:border-gray-700">
        <div class="px-4 py-2 border-b dark:border-gray-700 font-semibold">{{ zoom.title }} Zoom</div>
        <div class="px-4 py-2 flex items-center gap-2">
          <label class="text-gray-600 dark:text-gray-400">Zoom From</label>
          <input
            ref="zoomInput"
            v-model="zoom.search"
            class="flex-1 border dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-800"
            @keydown="onZoomKey"
          />
        </div>
        <div class="flex-1 overflow-auto">
          <div
            v-for="(item, i) in zoomItems"
            :key="item.value"
            class="px-4 py-1 cursor-pointer flex gap-4"
            :class="i === zoom.index ? 'bg-blue-100 dark:bg-blue-900' : ''"
            @mousedown.prevent="pickZoom(item)"
          >
            <span class="w-24 font-mono">{{ item.code }}</span>
            <span class="truncate">{{ item.label }}</span>
          </div>
          <div v-if="!zoomItems.length" class="px-4 py-2 text-gray-500">No matches</div>
        </div>
        <div class="px-4 py-2 border-t dark:border-gray-700 flex gap-2 text-xs">
          <button :class="btn" @mousedown.prevent="zoomItems[zoom.index] && pickZoom(zoomItems[zoom.index])">&lt;Enter&gt;=Select</button>
          <button :class="btn" @mousedown.prevent="zoomAdd">&lt;F6&gt;=Add</button>
          <button :class="btn" @mousedown.prevent="closeZoom">&lt;Esc&gt;=Close</button>
        </div>
      </div>
    </div>

    <!-- Batch list -->
    <div
      v-if="batchList.open"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      @mousedown.self="batchList.open = false"
    >
      <div class="bg-white dark:bg-gray-900 rounded shadow-xl w-[30rem] max-h-[70vh] flex flex-col border dark:border-gray-700">
        <div class="px-4 py-2 border-b dark:border-gray-700 font-semibold">Draft batches</div>
        <div class="flex-1 overflow-auto">
          <div
            v-for="b in batchList.items"
            :key="b.name"
            class="px-4 py-2 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 flex justify-between"
            @click="openBatch(b.name)"
          >
            <span>Batch {{ b.name }}</span>
            <span class="text-gray-500">{{ b.label }}</span>
          </div>
          <div v-if="!batchList.items.length" class="px-4 py-2 text-gray-500">No other draft batches</div>
        </div>
        <div class="px-4 py-2 border-t dark:border-gray-700 flex gap-2">
          <button :class="btn" @click="newBatch">New batch</button>
          <button :class="btn" @click="batchList.open = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Doc } from 'fyo/model/doc';
import { DEFAULT_TAX_CODES, VatType } from 'models/baseModels/Tax/Tax';
import { Money } from 'pesa';
import { fyo } from 'src/initFyo';
import { showDialog, showToast } from 'src/utils/interactive';
import { showSidebar } from 'src/utils/refs';
import { toggleSidebar } from 'src/utils/ui';
import { defineComponent, nextTick } from 'vue';

type Gcs = 'G' | 'C' | 'S';
type ColKey =
  | 'per'
  | 'date'
  | 'gcs'
  | 'account'
  | 'rec'
  | 'reference'
  | 'description'
  | 'tax'
  | 'excl'
  | 'incl'
  | 'debit'
  | 'credit'
  | 'contra';

type Row = {
  id: number;
  date: string;
  dateText: string;
  per: string;
  gcs: Gcs;
  account: string;
  accountValue: string;
  accountLabel: string;
  reference: string;
  description: string;
  tax: string;
  excl: string;
  incl: string;
  debit: string;
  credit: string;
  contra: string;
  contraValue: string;
  contraLabel: string;
  error: string;
  [key: string]: string | number;
};

type Column = {
  key: ColKey;
  label: string;
  width: string;
  align?: 'right';
  display?: boolean;
};

type LookupItem = { value: string; code: string; label: string };
type AccountItem = LookupItem & { accountType: string };
type PartyItem = LookupItem & { role: string };
type TaxItem = { name: string; code: string; rate: number; vatType: string };
type PeriodItem = {
  name: string;
  periodNumber: number;
  fiscalYear: string;
  start: string;
  end: string;
  closed: boolean;
};

let rowSeq = 1;

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toISO(value: unknown): string {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }

  return String(value).slice(0, 10);
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function parseAmount(text: string): number {
  if (!text) {
    return 0;
  }

  let s = String(text).replace(/[R\s]/gi, '');
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }

  s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function isoFrom(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

// ISO yyyy-mm-dd -> dd/mm/yyyy
function isoToDisplay(iso: string): string {
  if (!iso) {
    return '';
  }

  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// "15", "15/10", "15/10/2026", "15-10-26" -> ISO, filling the rest from
// the fallback date (the line's period). Returns '' if invalid.
function parseDateInput(text: string, fallbackIso: string): string {
  const t = text.trim();
  if (!t) {
    return fallbackIso;
  }

  const parts = t.split(/[/\-. ]/).filter(Boolean);
  const [fy, fm] = fallbackIso.split('-').map(Number);
  const d = Number(parts[0]);
  const m = parts[1] ? Number(parts[1]) : fm;
  let y = parts[2] ? Number(parts[2]) : fy;
  if (y < 100) {
    y += 2000;
  }

  if (!m || m < 1 || m > 12 || !d || d < 1 || d > daysInMonth(y, m)) {
    return '';
  }

  return isoFrom(y, m, d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n ? round2(n).toFixed(2) : '';
}

function accountCode(name: string): string {
  const i = name.indexOf(' - ');
  return i > 0 ? name.slice(0, i) : name;
}

function incrementRef(ref: string): string {
  const m = ref.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) {
    return ref;
  }

  const [, pre, num, post] = m;
  const next = String(Number(num) + 1).padStart(num.length, '0');
  return `${pre}${next}${post}`;
}

export default defineComponent({
  name: 'BatchEntry',
  props: {
    kind: { type: String, required: true },
  },
  setup() {
    return { showSidebar };
  },
  data() {
    return {
      tab: 'Payments' as 'Payments' | 'Receipts',
      entryType: 'General' as 'General' | 'Customer' | 'Supplier',
      bankAccount: '',
      bankAccounts: [] as AccountItem[],
      accounts: [] as AccountItem[],
      parties: [] as PartyItem[],
      taxes: [] as TaxItem[],
      periods: [] as PeriodItem[],
      rows: [] as Row[],
      doc: null as Doc | null,
      dirty: false,
      inclusive: true,
      activeRow: 0,
      activeCol: 'date' as ColKey,
      focusValue: '',
      balance: 0,
      showUpdateMenu: false,
      saveChain: Promise.resolve(true) as Promise<boolean>,
      dropdown: {
        open: false,
        r: 0,
        key: 'account' as ColKey,
        index: 0,
        filter: true,
        style: {} as Record<string, string>,
      },
      zoom: {
        open: false,
        title: '',
        search: '',
        index: 0,
        target: 'account' as 'account' | 'contra',
        row: 0,
      },
      batchList: {
        open: false,
        items: [] as { name: string; label: string }[],
      },
      btn: 'border dark:border-gray-700 rounded px-3 py-1 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700',
      btnOff: 'border dark:border-gray-700 rounded px-3 py-1 text-gray-400 dark:text-gray-600 cursor-not-allowed',
    };
  },
  computed: {
    isCashbook(): boolean {
      return this.kind === 'cashbook';
    },
    schemaName(): string {
      return this.isCashbook ? 'CashbookBatch' : 'JournalBatch';
    },
    vatEnabled(): boolean {
      return !!fyo.singles.AccountingSettings?.vatRegistered;
    },
    fixedGcs(): Gcs | null {
      if (this.isCashbook) {
        return null;
      }

      if (this.entryType === 'Customer') {
        return 'C';
      }

      if (this.entryType === 'Supplier') {
        return 'S';
      }

      return null;
    },
    columns(): Column[] {
      if (this.isCashbook) {
        return [
          { key: 'per', label: 'Per', width: 'w-14' },
          { key: 'date', label: 'Date', width: 'w-36' },
          { key: 'gcs', label: 'GCS', width: 'w-12' },
          { key: 'account', label: 'Account', width: 'w-28' },
          { key: 'rec', label: 'R', width: 'w-8', display: true },
          { key: 'reference', label: 'Reference', width: 'w-28' },
          { key: 'description', label: 'Description', width: '' },
          { key: 'tax', label: 'Tax', width: 'w-12' },
          { key: 'excl', label: 'Bank Exclusive', width: 'w-32', align: 'right' },
          { key: 'incl', label: 'Bank Inclusive', width: 'w-32', align: 'right' },
        ];
      }

      return [
        { key: 'per', label: 'Per', width: 'w-14' },
        { key: 'date', label: 'Date', width: 'w-36' },
        { key: 'gcs', label: 'GCS', width: 'w-12' },
        { key: 'account', label: 'Account', width: 'w-28' },
        { key: 'reference', label: 'Reference', width: 'w-28' },
        { key: 'description', label: 'Description', width: '' },
        { key: 'debit', label: 'Debit', width: 'w-32', align: 'right' },
        { key: 'credit', label: 'Credit', width: 'w-32', align: 'right' },
        { key: 'tax', label: 'Tax', width: 'w-12' },
        { key: 'contra', label: 'Contra Account', width: 'w-28' },
      ];
    },
    editableKeys(): ColKey[] {
      return this.columns.filter((c) => !c.display).map((c) => c.key);
    },
    gridTint(): string {
      if (!this.isCashbook) {
        return '';
      }

      return this.tab === 'Payments'
        ? 'bg-amber-50 dark:bg-gray-890'
        : 'bg-sky-50 dark:bg-gray-890';
    },
    balanceText(): string {
      const b = round2(this.balance);
      return `${this.money(Math.abs(b))}${b < 0 ? ' C' : ' D'}`;
    },
    batchTotal(): number {
      return this.rows.reduce((sum, r) => sum + parseAmount(r.incl), 0);
    },
    outOfBalance(): number {
      return this.rows.reduce((sum, r) => {
        if (r.contraValue) {
          return sum;
        }
        return sum + parseAmount(r.debit) - parseAmount(r.credit);
      }, 0);
    },
    statusTotal(): string {
      if (this.isCashbook) {
        return `${this.money(this.batchTotal)}${this.tab === 'Payments' ? ' C' : ' D'}`;
      }

      const n = round2(this.outOfBalance);
      if (!n) {
        return 'Balanced';
      }

      return `${this.money(Math.abs(n))}${n > 0 ? ' D' : ' C'}`;
    },
    statusAccount(): string {
      const row = this.rows[this.activeRow];
      if (!row) {
        return '';
      }

      if (row.error) {
        return row.error;
      }

      if (this.activeCol === 'contra' && row.contraLabel) {
        return row.contraLabel;
      }

      return row.accountLabel;
    },
    statusPeriod(): string {
      const row = this.rows[this.activeRow];
      if (!row?.date) {
        return '';
      }

      const period = this.periodFor(row.date);
      if (period?.closed) {
        return 'Closed period';
      }

      const current = this.periodFor(todayISO());
      if (!current) {
        return '';
      }

      const fy = this.periods.filter((p) => p.fiscalYear === current.fiscalYear);
      const start = fy.reduce((m, p) => (p.start < m ? p.start : m), current.start);
      const end = fy.reduce((m, p) => (p.end > m ? p.end : m), current.end);
      if (row.date < start) {
        return 'Last Year';
      }

      if (row.date > end) {
        return 'Next Year';
      }

      return '';
    },
    dropdownItems(): LookupItem[] {
      if (!this.dropdown.open) {
        return [];
      }

      const row = this.rows[this.dropdown.r];
      if (!row) {
        return [];
      }

      const all = this.optionsFor(row, this.dropdown.key);
      const s = String(row[this.dropdown.key] ?? '').trim().toLowerCase();
      if (!this.dropdown.filter || !s) {
        return all.slice(0, 200);
      }

      return all
        .filter(
          (i) =>
            i.code.toLowerCase().startsWith(s) ||
            i.label.toLowerCase().includes(s)
        )
        .slice(0, 200);
    },
    zoomItems(): LookupItem[] {
      const s = this.zoom.search.trim().toLowerCase();
      const list = this.lookupList(
        this.zoom.target === 'contra' ? 'G' : this.rows[this.zoom.row]?.gcs ?? 'G'
      );
      if (!s) {
        return list;
      }

      return list.filter(
        (i) =>
          i.code.toLowerCase().startsWith(s) ||
          i.label.toLowerCase().includes(s)
      );
    },
  },
  watch: {
    kind() {
      void this.init();
    },
  },
  async mounted() {
    await this.init();
  },
  async beforeUnmount() {
    await this.save(false);
  },
  methods: {
    money(n: number): string {
      return fyo.format(round2(n), 'Currency');
    },

    async init() {
      await this.loadLookups();
      if (this.isCashbook && !this.bankAccount) {
        this.bankAccount = this.bankAccounts[0]?.name ?? '';
      }

      await this.loadDraft();
      await this.loadBalance();
    },

    async loadLookups() {
      const accounts = (await fyo.db.getAll('Account', {
        fields: ['name', 'accountType', 'isGroup'],
      })) as { name: string; accountType?: string; isGroup?: boolean | number }[];

      this.accounts = accounts
        .filter((a) => !a.isGroup)
        .map((a) => ({
          value: a.name,
          code: accountCode(a.name),
          label: a.name,
          accountType: a.accountType ?? '',
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      this.bankAccounts = this.accounts.filter(
        (a) => a.accountType === 'Bank' || a.accountType === 'Cash'
      );

      const parties = (await fyo.db.getAll('Party', {
        fields: ['name', 'code', 'role'],
      })) as { name: string; code?: string; role?: string }[];

      this.parties = parties
        .map((p) => ({
          value: p.name,
          code: p.code || p.name,
          label: p.name,
          role: p.role ?? 'Both',
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      const taxes = (await fyo.db.getAll('Tax', {
        fields: ['name', 'code', 'vatType'],
      })) as { name: string; code?: string; vatType?: string }[];

      const details = (await fyo.db.getAll('TaxDetail', {
        fields: ['parent', 'rate'],
      })) as { parent: string; rate: number }[];

      this.taxes = taxes.map((t) => ({
        name: t.name,
        code: t.code || DEFAULT_TAX_CODES[t.vatType as VatType] || '',
        rate: details
          .filter((d) => d.parent === t.name)
          .reduce((s, d) => s + Number(d.rate || 0), 0),
        vatType: t.vatType ?? '',
      }));

      const periods = (await fyo.db.getAll('AccountingPeriod', {
        fields: ['name', 'periodNumber', 'fiscalYear', 'startDate', 'endDate', 'closed'],
      })) as {
        name: string;
        periodNumber: number;
        fiscalYear: string;
        startDate: unknown;
        endDate: unknown;
        closed?: boolean | number;
      }[];

      this.periods = periods.map((p) => ({
        name: p.name,
        periodNumber: p.periodNumber,
        fiscalYear: p.fiscalYear,
        start: toISO(p.startDate),
        end: toISO(p.endDate),
        closed: !!p.closed,
      }));
    },

    async loadBalance() {
      if (!this.isCashbook || !this.bankAccount) {
        this.balance = 0;
        return;
      }

      const entries = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
        fields: ['debit', 'credit'],
        filters: { account: this.bankAccount },
      })) as { debit: number | string; credit: number | string }[];

      this.balance = entries.reduce(
        (s, e) => s + Number(e.debit || 0) - Number(e.credit || 0),
        0
      );
    },

    lookupList(gcs: Gcs): LookupItem[] {
      if (gcs === 'C') {
        return this.parties.filter((p) => p.role !== 'Supplier');
      }

      if (gcs === 'S') {
        return this.parties.filter((p) => p.role !== 'Customer');
      }

      return this.accounts.filter((a) => a.value !== this.bankAccount);
    },

    resolve(gcs: Gcs, text: string): LookupItem | null {
      const t = text.trim().toLowerCase();
      if (!t) {
        return null;
      }

      const list = this.lookupList(gcs);
      const exact = list.find(
        (i) => i.code.toLowerCase() === t || i.label.toLowerCase() === t
      );
      if (exact) {
        return exact;
      }

      const starts = list.filter((i) => i.code.toLowerCase().startsWith(t));
      return starts.length === 1 ? starts[0] : null;
    },

    taxFor(code: string): TaxItem | null {
      const c = code.trim();
      if (!c || c === '00' || c === '0') {
        return null;
      }

      return this.taxes.find((t) => t.code === c) ?? null;
    },

    taxRate(row: Row): number {
      if (row.gcs !== 'G' && this.isCashbook) {
        return 0;
      }

      if (!this.isCashbook && this.entryType === 'General' && row.gcs !== 'G') {
        return 0;
      }

      return this.taxFor(row.tax)?.rate ?? 0;
    },

    periodFor(iso: string): PeriodItem | null {
      return this.periods.find((p) => p.start <= iso && iso <= p.end) ?? null;
    },

    perFor(iso: string): string {
      const p = iso ? this.periodFor(iso) : null;
      return p ? String(p.periodNumber).padStart(2, '0') : '';
    },

    maxLength(key: ColKey): number | undefined {
      if (key === 'gcs') {
        return 1;
      }

      if (key === 'tax' || key === 'per') {
        return 2;
      }

      if (key === 'date') {
        return 10;
      }

      return undefined;
    },

    cellText(row: Row, key: ColKey): string {
      if (key === 'date') {
        return row.dateText;
      }

      return String(row[key] ?? '');
    },

    // Periods of the financial year the line's date falls in.
    periodsForRow(row: Row): PeriodItem[] {
      const current = this.periodFor(row.date || todayISO()) ?? this.periodFor(todayISO());
      const fy = current?.fiscalYear;
      return this.periods
        .filter((p) => !fy || p.fiscalYear === fy)
        .sort((a, b) => a.start.localeCompare(b.start));
    },

    setPeriod(row: Row, period: PeriodItem) {
      const [y, m] = period.start.split('-').map(Number);
      const day = Number((row.date || period.start).split('-')[2]) || 1;
      row.date = isoFrom(y, m, Math.min(day, daysInMonth(y, m)));
      row.dateText = isoToDisplay(row.date);
      row.per = String(period.periodNumber).padStart(2, '0');
      this.dirty = true;
    },

    isDropdownCol(key: ColKey): boolean {
      return ['per', 'gcs', 'account', 'tax', 'contra'].includes(key);
    },

    mustChoose(row: Row, key: ColKey): boolean {
      if (key === 'account') {
        return true;
      }

      if (key === 'tax') {
        return this.isEditable(row, 'tax');
      }

      if (key === 'contra') {
        return !this.isCashbook && this.entryType !== 'General';
      }

      return false;
    },

    optionsFor(row: Row, key: ColKey): LookupItem[] {
      if (key === 'per') {
        return this.periodsForRow(row).map((p) => {
          const [y, m] = p.start.split('-').map(Number);
          return {
            value: p.name,
            code: String(p.periodNumber).padStart(2, '0'),
            label: `${MONTHS[m - 1]} ${y}${p.closed ? ' (closed)' : ''}`,
          };
        });
      }

      if (key === 'gcs') {
        return [
          { value: 'G', code: 'G', label: 'General ledger' },
          { value: 'C', code: 'C', label: 'Customer' },
          { value: 'S', code: 'S', label: 'Supplier' },
        ];
      }

      if (key === 'tax') {
        return [
          { value: '00', code: '00', label: 'No VAT' },
          ...this.taxes
            .filter((t) => t.code)
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((t) => ({ value: t.code, code: t.code, label: t.name })),
        ];
      }

      if (key === 'contra') {
        return this.lookupList('G');
      }

      return this.lookupList(row.gcs);
    },

    openDropdown(r: number, key: ColKey) {
      const row = this.rows[r];
      if (!row || !this.isDropdownCol(key) || !this.isEditable(row, key)) {
        this.dropdown.open = false;
        return;
      }

      const el = document.querySelector(
        `input[data-r="${r}"][data-c="${key}"]`
      ) as HTMLInputElement | null;
      const rect = el?.getBoundingClientRect();
      const top = rect ? rect.bottom : 0;
      const spaceBelow = window.innerHeight - top;
      // Keep the list fully on screen (e.g. Contra, the last column).
      const width = Math.min(Math.max(rect?.width ?? 0, 360), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect?.left ?? 0, window.innerWidth - width - 8));
      this.dropdown = {
        open: true,
        r,
        key,
        index: 0,
        filter: false,
        style: {
          left: `${left}px`,
          width: `${width}px`,
          ...(spaceBelow < 300 && rect
            ? { bottom: `${window.innerHeight - rect.top}px` }
            : { top: `${top}px` }),
        },
      };

      // Highlight the current value if there is one.
      const current = String(row[key] ?? '').toLowerCase();
      const i = this.optionsFor(row, key).findIndex(
        (o) => o.code.toLowerCase() === current
      );
      this.dropdown.index = i >= 0 ? i : 0;
      this.scrollDropdown();
    },

    scrollDropdown() {
      void nextTick(() => {
        const el = this.$refs.ddActive as HTMLElement | HTMLElement[] | undefined;
        const node = Array.isArray(el) ? el[0] : el;
        node?.scrollIntoView({ block: 'nearest' });
      });
    },

    selectDropdown(item: LookupItem, move = true) {
      const { r, key } = this.dropdown;
      const row = this.rows[r];
      this.dropdown.open = false;
      if (!row) {
        return;
      }

      if (key === 'per') {
        const period = this.periods.find((p) => p.name === item.value);
        if (period) {
          this.setPeriod(row, period);
        }
      } else if (key === 'gcs') {
        if (row.gcs !== item.value) {
          row.gcs = item.value as Gcs;
          row.account = '';
          row.accountValue = '';
          row.accountLabel = '';
          if (row.gcs !== 'G') {
            row.tax = '';
          }
          this.recalc(row, 'tax');
        }
      } else if (key === 'tax') {
        row.tax = item.code;
        row.error = '';
        this.recalc(row, 'tax');
      } else if (key === 'contra') {
        row.contra = item.code;
        row.contraValue = item.value;
        row.contraLabel = item.label;
        row.error = '';
      } else {
        row.account = item.code;
        row.accountValue = item.value;
        row.accountLabel = item.label;
        row.error = '';
        if (this.isCashbook && !row.description) {
          row.description = `${this.tab === 'Payments' ? 'Payment' : 'Receipt'} - ${item.code}`;
        }
      }

      this.focusValue = String(row[key] ?? '');
      this.dirty = true;
      if (move) {
        this.nextCell(r, key);
      }
    },

    displayValue(row: Row, key: ColKey): string {
      if (key === 'per') {
        const p = row.date ? this.periodFor(row.date) : null;
        return p ? String(p.periodNumber).padStart(2, '0') : '';
      }

      if (key === 'rec') {
        return 'N';
      }

      return String(row[key] ?? '');
    },

    cellClass(row: Row, col: Column): string {
      if (col.key === 'per') {
        const p = row.date ? this.periodFor(row.date) : null;
        return p?.closed ? 'text-red-600 font-semibold' : '';
      }

      if (col.key === 'account' && row.account && !row.accountValue) {
        return 'bg-red-100 dark:bg-red-900';
      }

      if (col.key === 'contra' && row.contra && !row.contraValue) {
        return 'bg-red-100 dark:bg-red-900';
      }

      if (col.key === 'tax' && row.tax && row.tax !== '00' && !this.taxFor(row.tax)) {
        return 'bg-red-100 dark:bg-red-900';
      }

      return '';
    },

    isEditable(row: Row, key: ColKey): boolean {
      if (key === 'gcs') {
        return !this.fixedGcs;
      }

      if (key === 'tax') {
        if (!this.vatEnabled) {
          return false;
        }

        if (this.isCashbook || this.entryType === 'General') {
          return row.gcs === 'G';
        }

        return true;
      }

      if (key === 'excl') {
        return !this.inclusive;
      }

      if (key === 'incl') {
        return this.inclusive;
      }

      return true;
    },

    newRow(prev?: Row): Row {
      const gcs: Gcs = this.fixedGcs ?? 'G';
      let reference = '';
      if (prev?.reference) {
        reference = incrementRef(prev.reference);
      } else if (this.isCashbook) {
        reference = this.tab === 'Payments' ? 'PMT00001' : 'RCT00001';
      } else {
        reference = 'JNL00001';
      }

      const date = prev?.date || todayISO();
      return {
        id: rowSeq++,
        date,
        dateText: isoToDisplay(date),
        per: this.perFor(date),
        gcs,
        account: '',
        accountValue: '',
        accountLabel: '',
        reference,
        description: this.isCashbook ? '' : prev?.description ?? '',
        tax: '',
        excl: '',
        incl: '',
        debit: '',
        credit: '',
        contra: '',
        contraValue: '',
        contraLabel: '',
        error: '',
      };
    },

    ensureRows() {
      if (!this.rows.length) {
        this.rows.push(this.newRow());
      }
    },

    rowHasContent(row: Row): boolean {
      return !!(
        row.accountValue ||
        parseAmount(row.incl) ||
        parseAmount(row.debit) ||
        parseAmount(row.credit)
      );
    },

    focusCell(r: number, key: ColKey) {
      void nextTick(() => {
        const el = document.querySelector(
          `input[data-r="${r}"][data-c="${key}"]`
        ) as HTMLInputElement | null;
        el?.focus();
        if (el && el.type !== 'date') {
          el.select();
        }
      });
    },

    firstEditable(row: Row): ColKey {
      return this.editableKeys.find((k) => this.isEditable(row, k)) ?? 'date';
    },

    lastEditable(row: Row): ColKey {
      const keys = this.editableKeys.filter((k) => this.isEditable(row, k));
      return keys[keys.length - 1] ?? 'date';
    },

    nextCell(r: number, key: ColKey, back = false) {
      const row = this.rows[r];
      const keys = this.editableKeys.filter((k) => this.isEditable(row, k));
      const i = keys.indexOf(key);

      if (!back && i < keys.length - 1) {
        return this.focusCell(r, keys[i + 1]);
      }

      if (back && i > 0) {
        return this.focusCell(r, keys[i - 1]);
      }

      if (!back) {
        if (r === this.rows.length - 1) {
          this.rows.push(this.newRow(row));
          void this.save(false);
        }
        return this.focusCell(r + 1, this.firstEditable(this.rows[r + 1]));
      }

      if (r > 0) {
        this.focusCell(r - 1, this.lastEditable(this.rows[r - 1]));
      }
    },

    onFocus(r: number, key: ColKey, row: Row) {
      this.activeRow = r;
      this.activeCol = key;
      this.focusValue = key === 'date' ? row.dateText : String(row[key] ?? '');
      this.showUpdateMenu = false;
      if (this.isDropdownCol(key)) {
        this.openDropdown(r, key);
      } else {
        this.dropdown.open = false;
      }
    },

    onInput(event: Event, row: Row, key: ColKey) {
      const target = event.target as HTMLInputElement;
      let value = target.value;
      if (key === 'gcs') {
        value = value.toUpperCase();
      }

      if (key === 'date') {
        row.dateText = value;
      } else {
        row[key] = value;
      }

      this.dirty = true;
      if (this.isDropdownCol(key)) {
        if (!this.dropdown.open) {
          this.openDropdown(this.activeRow, key);
        }
        this.dropdown.filter = true;
        this.dropdown.index = 0;
      }
    },

    onBlur(row: Row, key: ColKey) {
      const changed =
        (key === 'date' ? row.dateText : String(row[key] ?? '')) !== this.focusValue;

      if (key === 'date') {
        const fallback = row.date || this.periodsForRow(row)[0]?.start || todayISO();
        const iso = parseDateInput(row.dateText, fallback);
        if (iso) {
          row.date = iso;
          row.error = '';
        } else {
          row.error = `Date "${row.dateText}" is not valid. Use dd/mm/yyyy.`;
        }
        row.dateText = isoToDisplay(row.date);
        row.per = this.perFor(row.date);
      }

      if (key === 'per' && changed) {
        const n = Number(row.per);
        const period = this.periodsForRow(row).find((p) => p.periodNumber === n);
        if (period) {
          this.setPeriod(row, period);
        } else {
          row.per = this.perFor(row.date);
        }
      }

      if (key === 'gcs') {
        const g = String(row.gcs).toUpperCase();
        const valid: Gcs = g === 'C' || g === 'S' ? (g as Gcs) : 'G';
        if (valid !== row.gcs || changed) {
          row.gcs = valid;
          if (changed) {
            row.account = '';
            row.accountValue = '';
            row.accountLabel = '';
            if (valid !== 'G') {
              row.tax = '';
            }
            this.recalc(row, 'tax');
          }
        }
      }

      if (key === 'account') {
        const item = this.resolve(row.gcs, row.account);
        row.accountValue = item?.value ?? '';
        row.accountLabel = item?.label ?? '';
        row.error = row.account && !item ? `Account "${row.account}" not found. Press Ctrl+Enter to zoom.` : '';
        if (item) {
          row.account = item.code;
          if (this.isCashbook && !row.description) {
            row.description = `${this.tab === 'Payments' ? 'Payment' : 'Receipt'} - ${item.code}`;
          }
        }
      }

      if (key === 'contra') {
        const item = this.resolve('G', row.contra);
        row.contraValue = item?.value ?? '';
        row.contraLabel = item?.label ?? '';
        row.error = row.contra && !item ? `Contra "${row.contra}" not found. Press Ctrl+Enter to zoom.` : '';
        if (item) {
          row.contra = item.code;
        }
      }

      if (key === 'tax') {
        if (row.tax === '0') {
          row.tax = '00';
        }
        row.error = row.tax && row.tax !== '00' && !this.taxFor(row.tax) ? `Tax code "${row.tax}" not found.` : '';
        this.recalc(row, 'tax');
      }

      if (key === 'excl' || key === 'incl') {
        this.recalc(row, key);
      }

      if (key === 'debit' || key === 'credit') {
        const other = key === 'debit' ? 'credit' : 'debit';
        let n = parseAmount(String(row[key]));
        if (n && changed && !this.inclusive) {
          const rate = this.taxRate(row);
          n = round2(n * (1 + rate / 100));
        }
        row[key] = fmt(n);
        if (n) {
          row[other] = '';
        }
      }
    },

    recalc(row: Row, source: 'excl' | 'incl' | 'tax') {
      if (!this.isCashbook) {
        return;
      }

      const rate = this.taxRate(row);
      const fromIncl = source === 'incl' || (source === 'tax' && this.inclusive);
      if (fromIncl) {
        const incl = parseAmount(row.incl);
        const vat = rate ? round2((incl * rate) / (100 + rate)) : 0;
        row.incl = fmt(incl);
        row.excl = fmt(incl - vat);
      } else {
        const excl = parseAmount(row.excl);
        row.excl = fmt(excl);
        row.incl = fmt(round2(excl * (1 + rate / 100)));
      }
    },

    onCellKey(event: KeyboardEvent, r: number, key: ColKey) {
      const row = this.rows[r];

      if (event.key === 'Enter' && event.ctrlKey) {
        if (key === 'account' || key === 'contra') {
          event.preventDefault();
          this.dropdown.open = false;
          this.openZoom(r, key);
        }
        return;
      }

      const ddOpen = this.dropdown.open && this.dropdown.r === r && this.dropdown.key === key;

      if (ddOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const max = this.dropdownItems.length - 1;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.dropdown.index = Math.min(Math.max(this.dropdown.index + step, 0), max);
        this.scrollDropdown();
        return;
      }

      if (!ddOpen && this.isDropdownCol(key) && (event.key === 'ArrowDown' || event.key === 'F4')) {
        event.preventDefault();
        this.openDropdown(r, key);
        return;
      }

      if (event.key === 'Escape' && ddOpen) {
        event.preventDefault();
        this.dropdown.open = false;
        return;
      }

      if (event.key !== 'Tab' && event.key !== 'Enter') {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        this.dropdown.open = false;
        (event.target as HTMLInputElement).blur();
        this.nextCell(r, key, true);
        return;
      }

      if (this.isDropdownCol(key)) {
        const text = String(row[key] ?? '').trim();

        // Typed something: take the highlighted (or exact) match.
        if (text && ddOpen && this.dropdown.filter && this.dropdownItems.length) {
          const exact = this.dropdownItems.find(
            (i) => i.code.toLowerCase() === text.toLowerCase()
          );
          this.selectDropdown(exact ?? this.dropdownItems[this.dropdown.index]);
          return;
        }

        // Picked with arrows without typing.
        if (ddOpen && !this.dropdown.filter && event.key === 'Enter' && this.dropdownItems.length) {
          this.selectDropdown(this.dropdownItems[this.dropdown.index]);
          return;
        }

        // Nothing chosen yet: keep the list open until something is picked.
        if (!text && this.mustChoose(row, key)) {
          if (!ddOpen) {
            this.openDropdown(r, key);
          }
          return;
        }
      }

      this.dropdown.open = false;
      (event.target as HTMLInputElement).blur();
      this.nextCell(r, key);
    },

    onGlobalKey(event: KeyboardEvent) {
      if (this.zoom.open || this.batchList.open) {
        return;
      }

      const k = event.key.toLowerCase();
      if (event.ctrlKey && k === 'd') {
        event.preventDefault();
        this.deleteRow(this.activeRow);
      } else if (event.ctrlKey && k === 'i') {
        event.preventDefault();
        this.insertRow(this.activeRow);
      } else if (event.ctrlKey && k === 's') {
        event.preventDefault();
        void this.save(true);
      } else if (event.key === 'F8') {
        event.preventDefault();
        this.toggleIncExc();
      } else if (event.key === 'F7' && this.isCashbook) {
        event.preventDefault();
        showToast({ message: 'Bank reconciliation is coming in Phase 3.', type: 'info' });
      } else if (event.key === 'F3') {
        event.preventDefault();
        showToast({ message: 'Allocation is not needed: debtors are balance forward.', type: 'info' });
      }
    },

    toggleMenu() {
      toggleSidebar();
      // Re-place an open drop-down after the layout shifts.
      if (this.dropdown.open) {
        const { r, key } = this.dropdown;
        setTimeout(() => this.openDropdown(r, key), 300);
      }
    },

    toggleIncExc() {
      this.inclusive = !this.inclusive;
    },

    deleteRow(r: number) {
      if (!this.rows.length) {
        return;
      }

      this.rows.splice(r, 1);
      this.ensureRows();
      this.activeRow = Math.min(r, this.rows.length - 1);
      this.dirty = true;
      this.focusCell(this.activeRow, this.firstEditable(this.rows[this.activeRow]));
    },

    insertRow(r: number) {
      const prev = this.rows[r - 1] ?? this.rows[r];
      this.rows.splice(r, 0, this.newRow(prev));
      this.dirty = true;
      this.focusCell(r, this.firstEditable(this.rows[r]));
    },

    // ---------- Zoom (Ctrl+Enter) ----------
    openZoom(r: number, target: 'account' | 'contra') {
      const row = this.rows[r];
      const gcs = target === 'contra' ? 'G' : row.gcs;
      this.zoom = {
        open: true,
        title: gcs === 'C' ? 'Customer' : gcs === 'S' ? 'Supplier' : 'General Ledger',
        search: String(row[target] ?? ''),
        index: 0,
        target,
        row: r,
      };
      void nextTick(() => (this.$refs.zoomInput as HTMLInputElement | undefined)?.focus());
    },

    closeZoom() {
      const { row, target } = this.zoom;
      this.zoom.open = false;
      this.focusCell(row, target);
    },

    pickZoom(item: LookupItem) {
      const row = this.rows[this.zoom.row];
      if (this.zoom.target === 'contra') {
        row.contra = item.code;
        row.contraValue = item.value;
        row.contraLabel = item.label;
      } else {
        row.account = item.code;
        row.accountValue = item.value;
        row.accountLabel = item.label;
        if (this.isCashbook && !row.description) {
          row.description = `${this.tab === 'Payments' ? 'Payment' : 'Receipt'} - ${item.code}`;
        }
      }

      row.error = '';
      this.dirty = true;
      const r = this.zoom.row;
      const target = this.zoom.target;
      this.zoom.open = false;
      this.nextCell(r, target);
    },

    onZoomKey(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.zoom.index = Math.min(this.zoom.index + 1, this.zoomItems.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.zoom.index = Math.max(this.zoom.index - 1, 0);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = this.zoomItems[this.zoom.index];
        if (item) {
          this.pickZoom(item);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeZoom();
      } else if (event.key === 'F6') {
        event.preventDefault();
        void this.zoomAdd();
      } else {
        this.zoom.index = 0;
      }
    },

    async zoomAdd() {
      const row = this.rows[this.zoom.row];
      const gcs = this.zoom.target === 'contra' ? 'G' : row.gcs;
      const { openQuickEdit } = await import('src/utils/ui');
      const doc =
        gcs === 'G'
          ? fyo.doc.getNewDoc('Account', { isGroup: false })
          : fyo.doc.getNewDoc('Party', {
              role: gcs === 'C' ? 'Customer' : 'Supplier',
            });

      this.zoom.open = false;
      doc.once('afterSync', async () => {
        await this.loadLookups();
        this.$router.back();
        showToast({ message: 'Added. Press Ctrl+Enter to pick it.', type: 'success' });
      });
      await openQuickEdit({ doc });
    },

    // ---------- Load / save ----------
    async loadDraft(name?: string) {
      this.doc = null;
      this.rows = [];

      let draftName = name;
      if (!draftName) {
        const filters: Record<string, unknown> = { submitted: false, cancelled: false };
        if (this.isCashbook) {
          filters.bankAccount = this.bankAccount;
          filters.batchType = this.tab;
        } else {
          filters.batchType = this.entryType;
        }

        const drafts = (await fyo.db.getAll(this.schemaName, {
          fields: ['name'],
          filters: filters as never,
          orderBy: 'modified',
          order: 'desc',
          limit: 1,
        })) as { name: string }[];
        draftName = drafts[0]?.name;
      }

      if (draftName) {
        this.doc = await fyo.doc.getDoc(this.schemaName, draftName);
        this.rows = this.rowsFromDoc(this.doc);
      }

      this.ensureRows();
      this.dirty = false;
      this.activeRow = 0;
      this.focusCell(0, this.firstEditable(this.rows[0]));
    },

    rowsFromDoc(doc: Doc): Row[] {
      const lines = (doc.get('lines') as Doc[] | undefined) ?? [];
      return lines.map((line) => {
        const lineType = (line.get('lineType') as string) ?? 'GL';
        const gcs: Gcs = lineType === 'Customer' ? 'C' : lineType === 'Supplier' ? 'S' : 'G';
        const entry = (line.get('entryAccount') as string) ?? '';
        const item = this.lookupList(gcs).find((i) => i.value === entry);
        const taxName = (line.get('tax') as string) ?? '';
        const tax = this.taxes.find((t) => t.name === taxName);
        const contraName = (line.get('contraAccount') as string) ?? '';
        const contra = this.accounts.find((a) => a.value === contraName);

        const row: Row = {
          ...this.newRow(),
          date: toISO(line.get('date')),
          dateText: isoToDisplay(toISO(line.get('date'))),
          per: this.perFor(toISO(line.get('date'))),
          gcs,
          account: item?.code ?? entry,
          accountValue: entry,
          accountLabel: item?.label ?? entry,
          reference: (line.get('reference') as string) ?? '',
          description: (line.get('description') as string) ?? '',
          tax: tax?.code ?? '',
          contra: contra?.code ?? contraName,
          contraValue: contraName,
          contraLabel: contra?.label ?? contraName,
        };

        if (this.isCashbook) {
          const incl = (line.get('amount') as Money | undefined)?.float ?? 0;
          row.incl = fmt(incl);
          const rate = this.taxRate(row);
          row.excl = fmt(incl - (rate ? round2((incl * rate) / (100 + rate)) : 0));
        } else {
          row.debit = fmt((line.get('debit') as Money | undefined)?.float ?? 0);
          row.credit = fmt((line.get('credit') as Money | undefined)?.float ?? 0);
        }

        return row;
      });
    },

    linesFromRows(): Record<string, unknown>[] {
      const lines: Record<string, unknown>[] = [];
      for (const row of this.rows) {
        if (!row.accountValue) {
          continue;
        }

        const lineType = row.gcs === 'C' ? 'Customer' : row.gcs === 'S' ? 'Supplier' : 'GL';
        const tax = this.taxFor(row.tax);
        const base = {
          lineType,
          refType: lineType === 'GL' ? 'Account' : 'Party',
          entryAccount: row.accountValue,
          date: isoToDate(row.date || todayISO()),
          reference: row.reference,
          description: row.description,
          tax: tax?.name ?? '',
        };

        if (this.isCashbook) {
          const incl = parseAmount(row.incl);
          if (!incl) {
            continue;
          }
          lines.push({ ...base, amount: fyo.pesa(incl) });
        } else {
          const debit = parseAmount(row.debit);
          const credit = parseAmount(row.credit);
          if (!debit && !credit) {
            continue;
          }
          lines.push({
            ...base,
            debit: fyo.pesa(debit),
            credit: fyo.pesa(credit),
            contraAccount: row.contraValue,
          });
        }
      }

      return lines;
    },

    // Saves run one after another so a batch is never created twice.
    save(notify: boolean): Promise<boolean> {
      const run = this.saveChain.then(() => this.doSave(notify));
      this.saveChain = run.catch(() => false);
      return run;
    },

    async doSave(notify: boolean): Promise<boolean> {
      const lines = this.linesFromRows();
      if (!lines.length && !this.doc) {
        if (notify) {
          showToast({ message: 'Nothing to save yet.', type: 'info' });
        }
        return false;
      }

      try {
        const firstDate = lines[0]?.date ?? new Date();
        const header: Record<string, unknown> = this.isCashbook
          ? { batchType: this.tab, bankAccount: this.bankAccount, date: firstDate }
          : { batchType: this.entryType, date: firstDate };

        if (!this.doc) {
          this.doc = fyo.doc.getNewDoc(this.schemaName, { ...header, lines });
        } else {
          await this.doc.set(header);
          await this.doc.set('lines', lines);
        }

        await this.doc.sync();
        this.dirty = false;
        if (notify) {
          showToast({ message: `Batch ${this.doc.name} saved.`, type: 'success' });
        }
        return true;
      } catch (err) {
        await this.showError('Could not save batch', err);
        return false;
      }
    },

    async showError(title: string, err: unknown) {
      await showDialog({
        title,
        detail: (err as Error)?.message ?? String(err),
        type: 'error',
        buttons: [{ label: 'OK', action: () => null, isPrimary: true, isEscape: true }],
      });
    },

    async submitDoc(doc: Doc): Promise<boolean> {
      try {
        await doc.submit();
        return true;
      } catch (err) {
        await doc.load();
        await this.showError(`Batch ${doc.name} not updated`, err);
        return false;
      }
    },

    async updateThis() {
      this.showUpdateMenu = false;
      const saved = await this.save(false);
      if (!saved || !this.doc) {
        showToast({ message: 'Nothing to update.', type: 'info' });
        return;
      }

      const name = this.doc.name;
      if (await this.submitDoc(this.doc)) {
        showToast({ message: `Batch ${name} updated to the ledger.`, type: 'success' });
        this.doc = null;
        this.rows = [];
        this.ensureRows();
        await this.loadBalance();
        this.focusCell(0, this.firstEditable(this.rows[0]));
      }
    },

    async updateAll() {
      this.showUpdateMenu = false;
      await this.save(false);

      const filters: Record<string, unknown> = { submitted: false, cancelled: false };
      if (this.isCashbook) {
        filters.bankAccount = this.bankAccount;
      }

      const drafts = (await fyo.db.getAll(this.schemaName, {
        fields: ['name'],
        filters: filters as never,
      })) as { name: string }[];

      let done = 0;
      for (const { name } of drafts) {
        const doc = await fyo.doc.getDoc(this.schemaName, name);
        if (await this.submitDoc(doc)) {
          done++;
        }
      }

      showToast({ message: `${done} of ${drafts.length} batches updated.`, type: done === drafts.length ? 'success' : 'warning' });
      await this.loadDraft();
      await this.loadBalance();
    },

    async changeBank(event: Event) {
      const value = (event.target as HTMLSelectElement).value;
      await this.save(false);
      this.bankAccount = value;
      await this.loadDraft();
      await this.loadBalance();
    },

    async changeEntryType(event: Event) {
      const value = (event.target as HTMLSelectElement).value;
      await this.save(false);
      this.entryType = value as 'General' | 'Customer' | 'Supplier';
      await this.loadDraft();
    },

    async setTab(tab: 'Payments' | 'Receipts') {
      if (tab === this.tab) {
        return;
      }

      await this.save(false);
      this.tab = tab;
      await this.loadDraft();
    },

    async openBatchList() {
      await this.save(false);
      const filters: Record<string, unknown> = { submitted: false, cancelled: false };
      if (this.isCashbook) {
        filters.bankAccount = this.bankAccount;
      }

      const drafts = (await fyo.db.getAll(this.schemaName, {
        fields: ['name', 'batchType', 'date'],
        filters: filters as never,
        orderBy: 'modified',
        order: 'desc',
      })) as { name: string; batchType: string; date: unknown }[];

      this.batchList.items = drafts
        .filter((d) => d.name !== this.doc?.name)
        .map((d) => ({ name: d.name, label: `${d.batchType} · ${toISO(d.date)}` }));
      this.batchList.open = true;
    },

    async openBatch(name: string) {
      this.batchList.open = false;
      const doc = await fyo.doc.getDoc(this.schemaName, name);
      if (this.isCashbook) {
        this.tab = doc.get('batchType') as 'Payments' | 'Receipts';
      } else {
        this.entryType = doc.get('batchType') as 'General' | 'Customer' | 'Supplier';
      }
      await this.loadDraft(name);
    },

    async newBatch() {
      this.batchList.open = false;
      this.doc = null;
      this.rows = [];
      this.ensureRows();
      this.focusCell(0, this.firstEditable(this.rows[0]));
    },

    async close() {
      await this.save(false);
      this.$router.back();
    },
  },
});
</script>
