// Creates a wallet and stores the key ONLY in the local .env (git-ignored). Prints the PUBLIC address only.
//   npm run wallet:new            -> Puente agent wallet (AGENT_PRIVATE_KEY / AGENT_ADDRESS)
//   npm run wallet:new -- --buyer -> separate test payer wallet (BUYER_PRIVATE_KEY / BUYER_ADDRESS)
// Refuses to overwrite an existing wallet.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const buyer = process.argv.includes("--buyer");
const KEY = buyer ? "BUYER_PRIVATE_KEY" : "AGENT_PRIVATE_KEY";
const ADDR = buyer ? "BUYER_ADDRESS" : "AGENT_ADDRESS";

const envPath = new URL("../.env", import.meta.url);
const examplePath = new URL("../.env.example", import.meta.url);
if (!existsSync(envPath)) copyFileSync(examplePath, envPath);
let env = readFileSync(envPath, "utf8");

const existing = env.match(new RegExp(`^${KEY}=(.+)$`, "m"));
if (existing && existing[1].trim()) {
  console.log(`A ${buyer ? "buyer" : "agent"} wallet already exists in .env. Not overwriting it.`);
  console.log("Address:", env.match(new RegExp(`^${ADDR}=(.*)$`, "m"))?.[1] ?? "(unknown)");
  process.exit(0);
}

const key = generatePrivateKey();
const account = privateKeyToAccount(key);
const line = (k, v) => new RegExp(`^${k}=.*$`, "m").test(env) ? (env = env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)) : (env += `\n${k}=${v}`);
line(KEY, key);
line(ADDR, account.address);
writeFileSync(envPath, env.endsWith("\n") ? env : env + "\n", { mode: 0o600 });

console.log(`${buyer ? "Buyer" : "Agent"} wallet created. Key saved to .env only (never printed).`);
console.log("Public address:", account.address);
