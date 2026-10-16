import { app, dialog, ipcMain, OpenDialogOptions } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import databaseManager from '../backend/database/manager';
import { IPC_ACTIONS } from '../utils/messages';
import type { Main } from '../main';

const KEEP_PER_COMPANY = 30;

export type BackupResult = {
  success: boolean;
  filePath?: string;
  message?: string;
};

type BackupSettings = { folder?: string };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'sa-backup.json');
}

async function readSettings(): Promise<BackupSettings> {
  try {
    return (await fs.readJson(settingsPath())) as BackupSettings;
  } catch {
    return {};
  }
}

async function writeSettings(settings: BackupSettings): Promise<void> {
  await fs.writeJson(settingsPath(), settings, { spaces: 2 });
}

export async function getBackupFolder(): Promise<string | null> {
  const settings = await readSettings();
  return settings.folder ?? null;
}

export async function chooseBackupFolder(
  main: Main
): Promise<string | null> {
  const current = await getBackupFolder();
  const options: OpenDialogOptions = {
    title: 'Choose backup folder',
    defaultPath: current ?? app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  };

  const result = main.mainWindow
    ? await dialog.showOpenDialog(main.mainWindow, options)
    : await dialog.showOpenDialog(options);

  const folder = result.filePaths?.[0];
  if (result.canceled || !folder) {
    return null;
  }

  const settings = await readSettings();
  await writeSettings({ ...settings, folder });
  return folder;
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pruneOldBackups(folder: string, base: string): Promise<void> {
  const pattern = new RegExp(
    `^${escapeRegex(base)}_\\d{4}-\\d{2}-\\d{2}_\\d{6}\\.books\\.db$`
  );

  const files = (await fs.readdir(folder))
    .filter((f) => pattern.test(f))
    .sort()
    .reverse();

  for (const f of files.slice(KEEP_PER_COMPANY)) {
    await fs.remove(path.join(folder, f));
  }
}

export async function backupNow(): Promise<BackupResult> {
  const folder = await getBackupFolder();
  if (!folder) {
    return {
      success: false,
      message: 'No backup folder set. Choose a backup folder first.',
    };
  }

  const dbPath = databaseManager.db?.dbPath;
  if (!dbPath || dbPath === ':memory:') {
    return { success: false, message: 'No company file is open.' };
  }

  let base = path.parse(dbPath).name;
  if (base.endsWith('.books')) {
    base = base.slice(0, -6);
  }

  try {
    await fs.ensureDir(folder);
    const target = path.join(folder, `${base}_${timestamp()}.books.db`);

    const driver = databaseManager.getDriver();
    if (!driver) {
      return { success: false, message: 'Could not open the company file.' };
    }

    try {
      await driver.backup(target);
    } finally {
      driver.close();
    }

    await pruneOldBackups(folder, base);
    return { success: true, filePath: target };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export function registerSABackupListeners(main: Main): void {
  ipcMain.handle(IPC_ACTIONS.BACKUP_GET_FOLDER, async () => {
    return await getBackupFolder();
  });

  ipcMain.handle(IPC_ACTIONS.BACKUP_CHOOSE_FOLDER, async () => {
    return await chooseBackupFolder(main);
  });

  ipcMain.handle(IPC_ACTIONS.BACKUP_NOW, async () => {
    return await backupNow();
  });
}