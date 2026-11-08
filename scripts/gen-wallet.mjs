// Creates the Puente agent wallet and stores the key ONLY in the local .env (git-ignored).
// Prints the PUBLIC address only. Refuses to overwrite an existing wallet.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url);
const examplePath = new URL("../.env.example", import.meta.url);

if (!existsSync(envPath)) copyFileSync(examplePath, envPath);
let env = readFileSync(envPath, "utf8");

const existing = env.match(/^AGENT_PRIVATE_KEY=(.+)$/m);
if (existing && existing[1].trim()) {
  const addr = env.match(/^AGENT_ADDRESS=(.*)$/m)?.[1] ?? "(unknown)";
  console.log("A wallet already exists in .env. Not overwriting it.");
  console.log("Address:", addr);
  process.exit(0);
}

const key = generatePrivateKey();
const account = privateKeyToAccount(key);
env = env
  .replace(/^AGENT_PRIVATE_KEY=.*$/m, `AGENT_PRIVATE_KEY=${key}`)
  .replace(/^AGENT_ADDRESS=.*$/m, `AGENT_ADDRESS=${account.address}`);
writeFileSync(envPath, env, { mode: 0o600 });

console.log("Agent wallet created. Key saved to .env only (never printed).");
console.log("Public address:", account.address);
