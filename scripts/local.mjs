import { spawn } from "node:child_process";
const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw Error("Use dev or start");
const port = process.env.PORT || "3000";
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535)
  throw Error("PORT must be 1024–65535");
console.log(
  "PRIVATE SYNC: use only on a computer and local server you control. Your personal code is exposed to this process. Never tunnel or publicly host this listener.",
);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    mode,
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PILOTS_LOCAL_SYNC: "1",
      PILOTS_SYNC_ORIGIN: `http://127.0.0.1:${port}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
