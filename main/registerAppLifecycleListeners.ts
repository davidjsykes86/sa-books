import { app } from 'electron';
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer';
import { Main } from '../main';
import { rendererLog } from './helpers';
import { emitMainProcessError } from 'backend/helpers';
import { backupNow, registerSABackupListeners } from './saBackup';

export default function registerAppLifecycleListeners(main: Main) {
  registerSABackupListeners(main);

  let quitBackupDone = false;
  app.on('before-quit', (event) => {
    if (quitBackupDone) {
      return;
    }

    event.preventDefault();
    quitBackupDone = true;

    backupNow()
      .then((result) => {
        if (!result.success) {
          console.log('Backup on close skipped:', result.message);
        }
      })
      .catch((err) => console.log('Backup on close failed:', err))
      .finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (main.mainWindow === null) {
      main.createWindow().catch((err) => emitMainProcessError(err));
    }
  });

  app.on('ready', () => {
    if (main.isDevelopment && !main.isTest) {
      installDevTools(main).catch((err) => emitMainProcessError(err));
    }

    main.createWindow().catch((err) => emitMainProcessError(err));
  });
}

async function installDevTools(main: Main) {
  try {
    await installExtension(VUEJS3_DEVTOOLS);
  } catch (e) {
    rendererLog(main, 'Vue Devtools failed to install', e);
  }
}