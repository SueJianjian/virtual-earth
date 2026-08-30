"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("virtualEarthDesktop", {
  onBeforeQuit: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("desktop:request-checkpoint", listener);
    return () => ipcRenderer.removeListener("desktop:request-checkpoint", listener);
  },
  checkpointComplete: () => ipcRenderer.send("desktop:checkpoint-complete"),
});
