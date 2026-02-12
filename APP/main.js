const { app, BrowserWindow } = require('electron');

// URL Twojego Gencorda – możesz zmienić np. na localhost
// gdy chcesz łączyć się z lokalnym serwerem:
// const GENCORD_URL = 'http://localhost:3000';
const GENCORD_URL = 'https://gencord-v2.onrender.com';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#18191c',
    autoHideMenuBar: true,
    title: 'Gencord',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL(GENCORD_URL);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

