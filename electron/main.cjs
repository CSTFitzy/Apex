const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = !app.isPackaged;
const APP_NAME = 'Apex';
const SERVER_PORT = process.env.PORT || 3000;
const CLIENT_DEV_PORT = 5173;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CLIENT_DEV_URL = `http://localhost:${CLIENT_DEV_PORT}`;

const ROOT_DIR = path.join(__dirname, '..');
const ICON_PATH = path.join(ROOT_DIR, 'assets', 'icons', 'apex-logo.png');

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {import('child_process').ChildProcess | null} */
let clientProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function startBackendServer() {
  const cwd = path.join(ROOT_DIR, 'server');
  const script = isDev ? 'dev' : 'start';

  serverProcess = spawn(npmCommand(), ['run', script], {
    cwd,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (code !== 0 && code !== null) {
      console.error(`Apex backend server exited with code ${code}`);
    }
  });
}

function startFrontendDevServer() {
  const cwd = path.join(ROOT_DIR, 'client');

  clientProcess = spawn(npmCommand(), ['run', 'dev', '--', '--port', String(CLIENT_DEV_PORT)], {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  clientProcess.on('exit', (code) => {
    clientProcess = null;
    if (code !== 0 && code !== null) {
      console.error(`Apex frontend dev server exited with code ${code}`);
    }
  });
}

function waitForUrl(url, timeoutMs = 30000, intervalMs = 300) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.destroy();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, intervalMs);
      });
    };

    check();
  });
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `About ${APP_NAME}`,
          click: () => shell.openExternal('https://github.com/CSTFitzy/sharknet'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    icon: ICON_PATH,
    backgroundColor: '#0a0e27',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const targetUrl = isDev ? CLIENT_DEV_URL : SERVER_URL;

  try {
    await waitForUrl(targetUrl);
  } catch (error) {
    console.error(error);
  }

  await mainWindow.loadURL(targetUrl);
}

function stopChildProcesses() {
  if (clientProcess) {
    clientProcess.kill();
    clientProcess = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  buildAppMenu();

  startBackendServer();
  if (isDev) {
    startFrontendDevServer();
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopChildProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopChildProcesses();
});

process.on('exit', stopChildProcesses);
