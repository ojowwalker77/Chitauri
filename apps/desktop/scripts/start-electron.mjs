import { spawn, spawnSync } from "node:child_process";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

if (process.platform === "darwin") {
  const helperArch = process.arch === "x64" ? "x64" : "arm64";
  const result = spawnSync(
    process.execPath,
    ["scripts/build-appsnap-helper.mjs", "--mode", "development", "--arch", helperArch],
    { cwd: desktopDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`AppSnap helper build failed with status ${result.status ?? "unknown"}.`);
  }
}

const child = spawn(resolveElectronPath(), ["dist-electron/main.js"], {
  stdio: "inherit",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
