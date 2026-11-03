import { spawn } from "node:child_process";
const children = [
  spawn("deno", ["task", "dev"], { stdio: "inherit" }),
  spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--config",
    "client/vite.config.ts",
    "--host",
    "127.0.0.1",
  ], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
}
