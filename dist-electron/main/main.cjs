// src/main/main.ts
var import_electron = require("electron");
var import_path = require("path");
var mainWindow = null;
async function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: (0, import_path.join)(import_electron.app.getAppPath(), "dist-electron", "preload", "preload.cjs")
    },
    titleBarStyle: "hidden"
  });
  mainWindow.on("resize", () => {
  });
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile((0, import_path.join)(import_electron.app.getAppPath(), "dist", "index.html"));
  }
}
import_electron.ipcMain.handle("gb:activate-tab", (event, { tabId, bounds }) => {
});
import_electron.ipcMain.on("gb:heartbeat", (event, data) => {
});
import_electron.app.whenReady().then(async () => {
  await createWindow();
  console.log("Electron main process ready. Backend API should be running on port 3000.");
  console.log("Make sure to run 'npm run dev' in another terminal.");
});
