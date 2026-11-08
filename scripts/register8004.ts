// T5: register Puente's ERC-8004 identity from wallet T. Uses an onchain data: URI (no hosting needed).
// Later (after deploy): npx tsx scripts/register8004.ts --set-uri <agentId>   (points the identity at https://<app>/agent.json)
import { AGENT, celoBalance, fmt } from "../src/chain.js";
import { IDENTITY_REGISTRY, register, registrationFile, setAgentURI, toDataUri } from "../src/identity.js";
import { ENV } from "../src/config.js";

const setIdx = process.argv.indexOf("--set-uri");
if (setIdx > -1) {
  const id = BigInt(process.argv[setIdx + 1]);
  const uri = `${ENV.publicUrl.replace(/\/$/, "")}/agent.json`;
  const h = await setAgentURI(id, uri);
  console.log("agentURI updated ->", uri, "tx", h);
  process.exit(0);
}

console.log("wallet:", AGENT, "CELO:", fmt(await celoBalance(), 18));
const { agentId, hash } = await register(toDataUri(registrationFile()));
console.log("REGISTERED. agentId =", agentId.toString(), "tx", hash);
console.log("Add to .env and Railway variables:  AGENT_ID=" + agentId.toString());
console.log("View: https://www.8004scan.io  (registry", IDENTITY_REGISTRY + ")");
process.exit(0);
