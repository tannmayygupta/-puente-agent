import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, http, isAddress, parseAbi, type Address } from "viem";
import { celo } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

declare global { interface Window { ethereum?: any } }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const I18N: Record<string, Record<string, string>> = {
  en: {
    connect: "Connect wallet", h1: "Dollars in. Pesos out. No bank.", sub: "Pay in USA₮, USD₮ or USDC. The recipient gets Argentine pesos, Brazilian reais or Colombian pesos on Celo, no bank in between.",
    nlLabel: "Describe it in your own words (optional)", nlPh: "Send $5 in pesos argentinos to 0x…", nlBtn: "Fill form", toLabel: "They receive", amtLabel: "You send (USD)", payWith: "Pay with", rcpLabel: "Recipient Celo address",
    getQuote: "Get quote", quoteTitle: "Your quote", fee: "Puente fee", total: "You pay", expires: "Quote expires in", payBtn: "Pay with wallet", payHint: "You sign a gasless USD authorization. Puente never asks for your keys.",
    progressTitle: "Sending…", s1: "Payment signed", s2: "Payment confirmed onchain", s3: "Local currency sent", howTitle: "How it works",
    how1: "You pay in dollars over x402. No account, no gas.", how2: "Puente's agent waits until it sees your payment onchain, swaps it into pesos or reais on Textile FX, and sends them to the recipient.", how3: "If anything fails, you are refunded automatically.",
    t1h: "No custody pool", t1p: "Each payment funds its own real Textile FX swap, then the pesos or reais go straight to the recipient.", t2h: "Safe by design", t2p: "Puente pays out only after it sees your payment onchain, and refunds automatically if anything fails.", t3h: "Verifiable", t3p: "ERC-8004 identity, tagged transactions and open stats. Check everything onchain.",
    agentsTitle: "For agents and developers", agentsP: "Any x402 client can use Puente. Create an order, then pay it. The 402 challenge lists the exact price.",
    disclaimer: "Hackathon prototype on Celo mainnet. Small limits ($1.25 to $5). Not a licensed money transmitter.",
    connected: "Connected", noWallet: "No wallet found. Open this page in MiniPay, MetaMask or another Celo wallet.", balance: "Balance", rateHint: "Rate", approx: "≈",
    badAddr: "Enter a valid recipient address (0x…).", connectFirst: "Connect your wallet first.", quoteFail: "Could not get a quote", payFail: "Payment failed", nlFilled: "Filled in", nlFail: "Could not read that, please fill the form",
    done: "Done! They received", viewPay: "Your payment", viewPayout: "Payout transaction", cashOut: "Cash out to a bank (Ripio)", again: "New payment", refunded: "Something went wrong, you were refunded:", expiredMsg: "Quote expired. Get a new quote.", stOrders: "completed orders", stVolume: "volume (USD)", stPayers: "unique payers", seconds: "s",
  },
  es: {
    connect: "Conectar billetera", h1: "Entran dólares. Salen pesos. Sin banco.", sub: "Pagá en USA₮, USD₮ o USDC. El destinatario recibe pesos argentinos, reales brasileños o pesos colombianos en Celo, sin bancos en el medio.",
    nlLabel: "Describilo con tus palabras (opcional)", nlPh: "Enviar $5 en pesos argentinos a 0x…", nlBtn: "Completar", toLabel: "Recibe", amtLabel: "Enviás (USD)", payWith: "Pagar con", rcpLabel: "Dirección Celo del destinatario",
    getQuote: "Ver cotización", quoteTitle: "Tu cotización", fee: "Comisión Puente", total: "Pagás", expires: "La cotización vence en", payBtn: "Pagar con billetera", payHint: "Firmás una autorización en dólares sin gas. Puente nunca te pide tus claves.",
    progressTitle: "Enviando…", s1: "Pago firmado", s2: "Pago confirmado onchain", s3: "Moneda local enviada", howTitle: "Cómo funciona",
    how1: "Pagás en dólares por x402. Sin cuenta, sin gas.", how2: "El agente de Puente espera a ver tu pago onchain, lo cambia a pesos o reales en Textile FX y los envía al destinatario.", how3: "Si algo falla, te devolvemos el pago automáticamente.",
    t1h: "Sin fondo común", t1p: "Cada pago financia su propio swap real en Textile FX y luego los pesos o reales van directo al destinatario.", t2h: "Seguro por diseño", t2p: "Puente paga solo después de ver tu pago onchain y devuelve el dinero automáticamente si algo falla.", t3h: "Verificable", t3p: "Identidad ERC-8004, transacciones etiquetadas y estadísticas abiertas. Todo se verifica onchain.",
    agentsTitle: "Para agentes y desarrolladores", agentsP: "Cualquier cliente x402 puede usar Puente. Creá una orden y pagala. El desafío 402 muestra el precio exacto.",
    disclaimer: "Prototipo de hackatón en Celo mainnet. Límites chicos ($1.25 a $5). No es un transmisor de dinero con licencia.",
    connected: "Conectado", noWallet: "No se encontró billetera. Abrí esta página en MiniPay, MetaMask u otra billetera Celo.", balance: "Saldo", rateHint: "Cotización", approx: "≈",
    badAddr: "Ingresá una dirección válida (0x…).", connectFirst: "Conectá tu billetera primero.", quoteFail: "No se pudo cotizar", payFail: "El pago falló", nlFilled: "Completado", nlFail: "No pude leerlo, completá el formulario",
    done: "¡Listo! Recibieron", viewPay: "Tu pago", viewPayout: "Transacción de pago", cashOut: "Retirar a un banco (Ripio)", again: "Nuevo pago", refunded: "Algo salió mal, te devolvimos el pago:", expiredMsg: "La cotización venció. Pedí otra.", stOrders: "órdenes completadas", stVolume: "volumen (USD)", stPayers: "pagadores únicos", seconds: "s",
  },
  pt: {
    connect: "Conectar carteira", h1: "Entram dólares. Saem reais. Sem banco.", sub: "Pague em USA₮, USD₮ ou USDC. O destinatário recebe pesos argentinos, reais ou pesos colombianos na Celo, sem banco no meio.",
    nlLabel: "Descreva com suas palavras (opcional)", nlPh: "Enviar $5 em reais para 0x…", nlBtn: "Preencher", toLabel: "Recebe", amtLabel: "Você envia (USD)", payWith: "Pagar com", rcpLabel: "Endereço Celo do destinatário",
    getQuote: "Ver cotação", quoteTitle: "Sua cotação", fee: "Taxa Puente", total: "Você paga", expires: "A cotação expira em", payBtn: "Pagar com carteira", payHint: "Você assina uma autorização em dólares sem gás. A Puente nunca pede suas chaves.",
    progressTitle: "Enviando…", s1: "Pagamento assinado", s2: "Pagamento confirmado onchain", s3: "Moeda local enviada", howTitle: "Como funciona",
    how1: "Você paga em dólares via x402. Sem conta, sem gás.", how2: "O agente da Puente espera ver seu pagamento onchain, troca por pesos ou reais na Textile FX e envia ao destinatário.", how3: "Se algo falhar, você é reembolsado automaticamente.",
    t1h: "Sem fundo comum", t1p: "Cada pagamento financia seu próprio swap real na Textile FX e depois os pesos ou reais vão direto ao destinatário.", t2h: "Seguro por design", t2p: "A Puente paga só depois de ver seu pagamento onchain e reembolsa automaticamente se algo falhar.", t3h: "Verificável", t3p: "Identidade ERC-8004, transações marcadas e estatísticas abertas. Tudo verificável onchain.",
    agentsTitle: "Para agentes e desenvolvedores", agentsP: "Qualquer cliente x402 pode usar a Puente. Crie um pedido e pague. O desafio 402 mostra o preço exato.",
    disclaimer: "Protótipo de hackathon na Celo mainnet. Limites pequenos ($1.25 a $5). Não é uma transmissora de dinheiro licenciada.",
    connected: "Conectado", noWallet: "Nenhuma carteira encontrada. Abra esta página no MiniPay, MetaMask ou outra carteira Celo.", balance: "Saldo", rateHint: "Câmbio", approx: "≈",
    badAddr: "Informe um endereço válido (0x…).", connectFirst: "Conecte sua carteira primeiro.", quoteFail: "Não foi possível cotar", payFail: "O pagamento falhou", nlFilled: "Preenchido", nlFail: "Não consegui ler, preencha o formulário",
    done: "Pronto! Receberam", viewPay: "Seu pagamento", viewPayout: "Transação do pagamento", cashOut: "Sacar para um banco (Ripio)", again: "Novo pagamento", refunded: "Algo deu errado, você foi reembolsado:", expiredMsg: "A cotação expirou. Peça outra.", stOrders: "pedidos concluídos", stVolume: "volume (USD)", stPayers: "pagadores únicos", seconds: "s",
  },
};

let lang = "en";
try { lang = localStorage.getItem("lang") ?? ((navigator.language || "en").slice(0, 2)); } catch { lang = (navigator.language || "en").slice(0, 2); }
if (!I18N[lang]) lang = "en";
const t = (k: string) => I18N[lang][k] ?? I18N.en[k] ?? k;

const FLAG: Record<string, string> = { AR: "🇦🇷", BR: "🇧🇷", CO: "🇨🇴", MX: "🇲🇽" };
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

interface Cfg { payTo: Address; attributionTag: string; agentId: string | null; currencies: { code: string; token: string; country: string; name: string; ratePerUsd: number | null }[]; acceptedTokens: { symbol: string; address: Address }[]; limits: { minUsd: number; maxUsd: number } }
let cfg: Cfg;
let account: Address | null = null;
let currency = "ARS";
let order: any = null;
let timer: number | undefined;
let pollTimer: number | undefined;

const fmtNum = (n: number, dp = 2) => new Intl.NumberFormat(lang === "en" ? "en-US" : lang === "es" ? "es-AR" : "pt-BR", { maximumFractionDigits: dp }).format(n);

function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh!); });
  const code = document.querySelector("pre code");
  if (code) code.textContent = code.textContent!.replaceAll("{origin}", location.origin);
  $("connect").textContent = account ? `${t("connected")} ${account.slice(0, 6)}…${account.slice(-4)}` : t("connect");
  renderCcy();
  updateRateHint();
}

function renderCcy() {
  const box = $("ccy");
  box.innerHTML = "";
  for (const c of cfg?.currencies ?? []) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(c.code === currency));
    b.innerHTML = `<b>${FLAG[c.country] ?? ""} ${c.code}</b><span>${c.token}${c.ratePerUsd ? " · " + fmtNum(c.ratePerUsd, c.ratePerUsd > 100 ? 0 : 2) + "/$" : ""}</span>`;
    b.onclick = () => { currency = c.code; renderCcy(); updateRateHint(); };
    box.appendChild(b);
  }
}

function updateRateHint() {
  const c = cfg?.currencies.find((x) => x.code === currency);
  const usd = Number(($("amt") as HTMLInputElement).value || 0);
  $("rateHint").textContent = c?.ratePerUsd && usd ? `${t("approx")} ${fmtNum(usd * c.ratePerUsd, 0)} ${c.token}` : "";
}

async function refreshBalance() {
  const sym = ($("tok") as HTMLSelectElement).value;
  if (!account || !cfg) { $("bal").textContent = ""; return; }
  const tk = cfg.acceptedTokens.find((x) => x.symbol === sym)!;
  try {
    const v = await pub.readContract({ address: tk.address, abi: erc20, functionName: "balanceOf", args: [account] });
    $("bal").textContent = `${t("balance")}: ${fmtNum(Number(formatUnits(v, 6)), 2)} ${sym}`;
  } catch { $("bal").textContent = ""; }
}

async function connect() {
  if (!window.ethereum) { showErr(t("noWallet")); return; }
  const accs: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  account = getAddress(accs[0]);
  applyI18n();
  refreshBalance();
}

function showErr(m: string) { $("err").textContent = m; }

async function loadCfg() {
  cfg = await (await fetch("/api/config")).json();
  if (!cfg.currencies.some((c) => c.code === currency)) currency = cfg.currencies[0].code;
  $("foot").innerHTML = `Agent wallet <a href="https://celoscan.io/address/${cfg.payTo}" target="_blank" rel="noopener">${cfg.payTo.slice(0, 8)}…${cfg.payTo.slice(-6)}</a> · tag <code>${cfg.attributionTag}</code>${cfg.agentId ? ` · ERC-8004 agent <a href="https://8004scan.io" target="_blank" rel="noopener">#${cfg.agentId}</a>` : ""}`;
  applyI18n();
}

async function getQuote() {
  showErr("");
  const rcp = ($("rcp") as HTMLInputElement).value.trim();
  const usd = Number(($("amt") as HTMLInputElement).value);
  if (!isAddress(rcp, { strict: false })) return showErr(t("badAddr"));
  const btn = $("quoteBtn") as HTMLButtonElement;
  btn.disabled = true;
  try {
    const r = await fetch("/v1/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currency, recipient: rcp, usd, lang }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? t("quoteFail"));
    order = j.order;
    $("qLocal").textContent = fmtNum(Number(order.payoutLocal), 2);
    $("qTok").textContent = order.token;
    $("qFee").textContent = `$${order.feeUsd.toFixed(2)}`;
    $("qTotal").textContent = `$${order.price.usd.toFixed(2)}`;
    $("quoteBox").classList.remove("hidden"); $("idle").classList.add("hidden"); $("progress").classList.add("hidden");
    clearInterval(timer);
    const tick = () => {
      const s = Math.max(0, Math.round((order.expiresAt - Date.now()) / 1000));
      $("qTimer").textContent = `${s}${t("seconds")}`;
      ($("payBtn") as HTMLButtonElement).disabled = s <= 0;
      if (s <= 0) { clearInterval(timer); showErr(t("expiredMsg")); }
    };
    tick(); timer = window.setInterval(tick, 500);
  } catch (e) { showErr((e as Error).message); } finally { btn.disabled = false; }
}

function step(n: number, state: "on" | "done" | "off") {
  const el = $(`s${n}`); el.className = state === "off" ? "" : state;
}

async function pay() {
  showErr("");
  if (!order) return;
  if (!window.ethereum) return showErr(t("noWallet"));
  if (!account) await connect();
  if (!account) return showErr(t("connectFirst"));
  const payBtn = $("payBtn") as HTMLButtonElement;
  payBtn.disabled = true;
  try {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] }); } catch { /* some wallets are already on Celo */ }
    const wallet = createWalletClient({ account, chain: celo, transport: custom(window.ethereum) });
    const signer = { address: account, signTypedData: (a: any) => wallet.signTypedData({ account: account!, ...a }) };
    const client = new x402Client();
    client.register("eip155:*", new ExactEvmScheme(signer as any, { rpcUrl: "https://forno.celo.org" }));
    client.setSpendControls({ maxAmountPerPayment: "$30", allowedAssets: true } as never);
    const sym = ($("tok") as HTMLSelectElement).value;
    const want = cfg.acceptedTokens.find((x) => x.symbol === sym)!.address.toLowerCase();
    client.registerPolicy((_v: number, reqs: any[]) => { const m = reqs.filter((r) => String(r.asset).toLowerCase() === want); return m.length ? m : reqs; });
    const payFetch = wrapFetchWithPayment(fetch, client);

    clearInterval(timer);
    $("quoteBox").classList.add("hidden"); $("progress").classList.remove("hidden"); $("receipt").classList.add("hidden");
    step(1, "on"); step(2, "off"); step(3, "off");
    const res = await payFetch(`/v1/pay?order=${order.id}`, { method: "POST" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `HTTP ${res.status}`); }
    step(1, "done"); step(2, "on");
    poll();
  } catch (e) {
    $("progress").classList.add("hidden"); $("quoteBox").classList.remove("hidden");
    showErr(`${t("payFail")}: ${(e as Error).message}`);
    payBtn.disabled = false;
  }
}

function poll() {
  clearInterval(pollTimer);
  const run = async () => {
    const s = (await (await fetch(`/v1/orders/${order.id}`)).json()).order;
    if (s.state === "payment_pending") { step(1, "done"); step(2, "on"); }
    if (s.state === "paid_seen" || s.state === "paying_out") { step(2, "done"); step(3, "on"); }
    if (s.state === "completed") {
      clearInterval(pollTimer); step(1, "done"); step(2, "done"); step(3, "done");
      const r = $("receipt"); r.classList.remove("hidden");
      r.innerHTML = `<div class="ok">${t("done")} ${fmtNum(Number(s.payoutLocal), 2)} ${s.token}</div>
        <p><a href="${s.payTxUrl}" target="_blank" rel="noopener">${t("viewPay")} ↗</a><br><a href="${s.payoutTxUrl}" target="_blank" rel="noopener">${t("viewPayout")} ↗</a><br><a href="${s.offrampUrl}" target="_blank" rel="noopener">${t("cashOut")} ↗</a></p>
        <button class="btn" id="again">${t("again")}</button>`;
      $("again").onclick = () => { $("progress").classList.add("hidden"); $("idle").classList.remove("hidden"); order = null; refreshBalance(); };
    }
    if (s.state === "refunded" || s.state === "needs_manual" || s.state === "expired") {
      clearInterval(pollTimer);
      const r = $("receipt"); r.classList.remove("hidden");
      r.innerHTML = `<div>${t("refunded")} ${s.note ?? ""}</div>${s.refundTxUrl ? `<a href="${s.refundTxUrl}" target="_blank" rel="noopener">tx ↗</a>` : ""}`;
    }
  };
  void run(); pollTimer = window.setInterval(run, 1500);
}

async function nlFill() {
  const text = ($("nl") as HTMLInputElement).value.trim();
  if (!text) return;
  $("nlHint").textContent = "…";
  try {
    const r = await fetch("/v1/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json();
    const p = j.parsed;
    if (p.currency && cfg.currencies.some((c) => c.code === p.currency)) currency = p.currency;
    if (p.usd) ($("amt") as HTMLInputElement).value = String(p.usd);
    else if (p.local) { const c = cfg.currencies.find((x) => x.code === currency); if (c?.ratePerUsd) ($("amt") as HTMLInputElement).value = (Math.round((p.local / c.ratePerUsd) * 100) / 100).toString(); }
    if (p.recipient) ($("rcp") as HTMLInputElement).value = p.recipient;
    if (["en", "es", "pt"].includes(p.lang) && p.lang !== lang) { lang = p.lang; ($("lang") as HTMLSelectElement).value = lang; }
    applyI18n();
    $("nlHint").textContent = `${t("nlFilled")} · ${j.via}`;
  } catch { $("nlHint").textContent = t("nlFail"); }
}

async function liveStats() {
  try {
    const s = await (await fetch("/stats")).json();
    $("liveStats").innerHTML = `<div><b>${s.orders.completed}</b><span>${t("stOrders")}</span></div><div><b>$${fmtNum(s.orders.volumeUsd, 0)}</b><span>${t("stVolume")}</span></div><div><b>${s.orders.uniquePayers}</b><span>${t("stPayers")}</span></div>`;
  } catch { /* ignore */ }
}

($("lang") as HTMLSelectElement).value = lang;
$("lang").addEventListener("change", (e) => { lang = (e.target as HTMLSelectElement).value; try { localStorage.setItem("lang", lang); } catch { /* ignore */ } applyI18n(); liveStats(); });
$("connect").onclick = () => void connect().catch((e) => showErr((e as Error).message));
$("quoteBtn").onclick = () => void getQuote();
$("payBtn").onclick = () => void pay();
$("nlBtn").onclick = () => void nlFill();
$("amt").addEventListener("input", updateRateHint);
$("tok").addEventListener("change", refreshBalance);
window.ethereum?.on?.("accountsChanged", (a: string[]) => { account = a[0] ? getAddress(a[0]) : null; applyI18n(); refreshBalance(); });

loadCfg().then(() => { liveStats(); setInterval(liveStats, 20000); setInterval(loadCfg, 60000); }).catch((e) => showErr(String(e)));
