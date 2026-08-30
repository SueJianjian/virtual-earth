"use strict";

const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require("electron");
const path = require("node:path");

app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

let mainWindow;
let tray;
let isQuitting = false;
let checkpointInFlight = false;
let checkpointTimeout;

const trayIcon = () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
      + '<rect width="32" height="32" rx="6" fill="#16231f"/>'
      + '<circle cx="16" cy="16" r="10" fill="#d6a94c"/>'
      + '<path d="M7 18c5-5 13-5 18 0" fill="none" stroke="#79c0c2" stroke-width="2"/>'
      + '<circle cx="16" cy="16" r="3" fill="#16231f"/>'
      + '</svg>',
  ).toString("base64");
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${svg}`).resize({ width: 16, height: 16 });
};

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const requestQuit = () => {
  if (isQuitting) return;
  isQuitting = true;
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit();
    return;
  }
  checkpointInFlight = true;
  showWindow();
  mainWindow.webContents.send("desktop:request-checkpoint");
  checkpointTimeout = setTimeout(() => {
    checkpointInFlight = false;
    app.quit();
  }, 1500);
};

const createApplicationMenu = () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { label: "关闭窗口", role: "close" },
        { type: "separator" },
        { label: "退出并保存", click: requestQuit },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
      ],
    },
    {
      label: "查看",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        { type: "separator" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { label: "恢复默认缩放", role: "resetZoom" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭窗口", role: "close" },
      ],
    },
  ]));
};

const createTray = () => {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip("虚拟地球 - 自主模拟");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开虚拟地球", click: showWindow },
    { type: "separator" },
    { label: "退出并保存", click: requestQuit },
  ]));
  tray.on("click", showWindow);
};

const createWindow = async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111512",
    show: false,
    title: "Virtual Earth",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.setBackgroundThrottling(false);

  mainWindow.once("ready-to-show", () => {
    createTray();
    showWindow();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return mainWindow;
};

ipcMain.on("desktop:checkpoint-complete", () => {
  if (!checkpointInFlight) return;
  checkpointInFlight = false;
  if (checkpointTimeout) clearTimeout(checkpointTimeout);
  app.quit();
});

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    createApplicationMenu();
    await createWindow();
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
      else showWindow();
    });
  });
}

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  requestQuit();
});

app.on("window-all-closed", () => {
  // The tray keeps the desktop simulation alive after the window is hidden.
});
