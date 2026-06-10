// Tap transaction web app.
// Asset URLs stay relative so each deployed repo can keep its own domain.

import { Attribution } from "https://esm.sh/ox/erc8021";

let PAYMASTER_SERVICE_URL = "";

async function loadRuntimeConfig() {
  if (typeof window !== "undefined" && typeof window.PAYMASTER_SERVICE_URL === "string") {
    PAYMASTER_SERVICE_URL = window.PAYMASTER_SERVICE_URL.trim();
    return PAYMASTER_SERVICE_URL;
  }
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) return PAYMASTER_SERVICE_URL;
    const j = await r.json();
    const url = (j?.paymasterServiceUrl || "").trim();
    if (url) PAYMASTER_SERVICE_URL = url;
  } catch {
    // Runtime config is optional for local/static preview.
  }
  return PAYMASTER_SERVICE_URL;
}

let __walletCaps = null;
let __walletCapsKey = "";

const __walletSession = {
  provider: null,
  from: null,
  ready: false,
  paymasterSupported: false,
  label: "",
};

const eip6963Providers = new Map();
const providerEventBound = new WeakSet();
let __provider = null;
let __providerLabel = "";
let __providerId = "";
let __account = null;
let __connectInFlight = null;
let __switchInFlight = null;

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event.detail || {};
    if (!detail.provider) return;
    const info = detail.info || {};
    const key = info.uuid || info.rdns || info.name || `wallet-${eip6963Providers.size}`;
    eip6963Providers.set(key, { provider: detail.provider, info });
  });
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch {
    // Older browsers may not support the event constructor.
  }
}

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const BASE_MAINNET_CHAIN_ID = "0x2105";

const TAP_CONTRACT = "0x02969f3269f78769c5d8d5682e56378cde8e0bb8"; // checksummed

const TIP_RECIPIENT = "0xC749E2959e244cD516C93Eb97cD5Eb8b66168924";

const LOG_ACTION_SELECTOR = "0x2d9bc1fb";
const ACTION_TAP = "TAP";

const BUILDER_CODE = "bc_jstvhjq5";
const builderCodeSuffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

function isHexAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isReadyToSend() {
  return isHexAddress(TAP_CONTRACT);
}

function toast(msg, ms = 2400) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => el.classList.remove("show"), ms);
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const store = {
  getPata() {
    const v = localStorage.getItem("pata");
    const n = v ? Number(v) : 150;
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 150;
  },
  setPata(n) {
    localStorage.setItem("pata", String(Math.max(0, Math.floor(n))));
  },
  getEnergy() {
    const v = localStorage.getItem("energy");
    const n = v ? Number(v) : 80;
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : 80;
  },
  setEnergy(n) {
    localStorage.setItem("energy", String(Math.max(0, Math.min(100, Math.floor(n)))));
  },
  getStreak() {
    const v = localStorage.getItem("streak");
    const n = v ? Number(v) : 0;
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  },
  setStreak(n) {
    localStorage.setItem("streak", String(Math.max(0, Math.floor(n))));
  },
  getLastPlayDay() {
    return localStorage.getItem("lastPlayDay") || "";
  },
  setLastPlayDay(d) {
    localStorage.setItem("lastPlayDay", d);
  },
};

const MILESTONES = [
  { at: 500, label: "Nice run" },
  { at: 1000, label: "Pata stack growing" },
  { at: 2500, label: "Tap streak strong" },
];

let pata = store.getPata();
let energy = store.getEnergy();
let streak = store.getStreak();
let nextMilestoneIdx = 0;

function fmt(n) {
  try {
    return n.toLocaleString("en-US");
  } catch {
    return String(n);
  }
}

function updateHud() {
  const pataEl = document.getElementById("pataText");
  const energyEl = document.getElementById("energyText");
  const streakEl = document.getElementById("streakText");
  if (pataEl) pataEl.textContent = fmt(pata);
  if (energyEl) energyEl.textContent = `${energy}/100`;
  if (streakEl) streakEl.textContent = String(streak);
}

function maybeUpdateStreak() {
  const today = todayKey();
  const last = store.getLastPlayDay();
  if (!last) {
    streak = 1;
    store.setStreak(streak);
    store.setLastPlayDay(today);
    return;
  }
  if (last === today) return;

  const lastDate = new Date(last + "T00:00:00");
  const todayDate = new Date(today + "T00:00:00");
  const diffDays = Math.round((todayDate - lastDate) / 86400000);
  streak = diffDays === 1 ? streak + 1 : 1;
  store.setStreak(streak);
  store.setLastPlayDay(today);
}

function spawnPlus(x, y, text) {
  const area = document.getElementById("tapArea");
  if (!area) return;
  const el = document.createElement("div");
  el.className = "floatPlus";
  el.textContent = text;
  const r = area.getBoundingClientRect();
  el.style.left = `${x - r.left}px`;
  el.style.top = `${y - r.top}px`;
  area.appendChild(el);
  window.setTimeout(() => el.remove(), 700);
}

function onTap(ev) {
  maybeUpdateStreak();
  const point = ev.touches?.[0] || ev;
  spawnPlus(point.clientX, point.clientY, "+1");

  if (energy > 0) {
    energy -= 1;
    store.setEnergy(energy);
    updateHud();
  }

  enqueueTapTx();

  if (nextMilestoneIdx < MILESTONES.length) {
    const m = MILESTONES[nextMilestoneIdx];
    if (pata >= m.at) {
      toast(m.label);
      nextMilestoneIdx += 1;
    }
  }
}

function startEnergyRegen() {
  window.setInterval(() => {
    const current = store.getEnergy();
    if (current < 100) {
      const next = Math.min(100, current + 1);
      store.setEnergy(next);
      energy = next;
      updateHud();
    }
  }, 5000);
}

function showPanel(name) {
  const earn = document.getElementById("earnPanel");
  const game = document.getElementById("gamePanel");
  if (earn) earn.hidden = name !== "earn";
  if (game) game.hidden = name === "earn";

  document.getElementById("navGame")?.classList.toggle("primary", name === "game");
  document.getElementById("navEarn")?.classList.toggle("primary", name === "earn");
  document.getElementById("navTip")?.classList.toggle("primary", name === "tip");

  if (name === "tip") openSheet();
  else closeSheet();
}

function openSheet() {
  const bd = document.getElementById("sheetBackdrop");
  if (!bd) return;
  bd.classList.add("show");
  bd.setAttribute("aria-hidden", "false");
}

function closeSheet() {
  const bd = document.getElementById("sheetBackdrop");
  if (!bd) return;
  bd.classList.remove("show");
  bd.setAttribute("aria-hidden", "true");
}

const TRANSFER_SELECTOR = "a9059cbb";

function pad32(hexNo0x) {
  return hexNo0x.padStart(64, "0");
}

function parseUsdcToBaseUnits(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("Enter an amount");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount");
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const units = BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded || "0");
  if (units <= 0n) throw new Error("Amount must be greater than 0");
  return units;
}

function encodeErc20Transfer(to, units) {
  const addr = to.replace(/^0x/, "").toLowerCase();
  const amt = units.toString(16);
  return "0x" + TRANSFER_SELECTOR + pad32(addr) + pad32(amt);
}

function hexPadLeft(hexNo0x, bytes) {
  return hexNo0x.replace(/^0x/, "").padStart(bytes * 2, "0");
}

function hexPadRight(hexNo0x, bytes) {
  return hexNo0x.replace(/^0x/, "").padEnd(bytes * 2, "0");
}

function bytes32FromAscii(text) {
  const enc = new TextEncoder();
  const b = enc.encode(String(text));
  const sliced = b.slice(0, 32);
  let hex = "";
  for (const x of sliced) hex += x.toString(16).padStart(2, "0");
  return "0x" + hexPadRight(hex, 32);
}

function uint256ToHex32(n) {
  const v = BigInt(n);
  return "0x" + hexPadLeft(v.toString(16), 32);
}

function abiEncodeLogAction(actionBytes32, dataHex) {
  const action = hexPadLeft(actionBytes32, 32);
  const dataNo0x = String(dataHex || "0x").replace(/^0x/, "");
  const dataLen = dataNo0x.length / 2;
  const offset = hexPadLeft("40", 32);
  const lenWord = hexPadLeft(dataLen.toString(16), 32);
  const paddedData = dataNo0x.padEnd(Math.ceil(dataLen / 32) * 64, "0");
  return LOG_ACTION_SELECTOR + action + offset + lenWord + paddedData;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = window.setTimeout(() => reject(new Error("Timed out waiting for wallet response")), timeoutMs);
  });
  return Promise.race([promise.finally(() => window.clearTimeout(t)), timeout]);
}

function shortAddress(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "Wallet";
}

function updateWalletStatus() {
  const el = document.getElementById("walletStatus");
  if (!el) return;
  if (__account) el.textContent = shortAddress(__account);
  else if (__providerLabel) el.textContent = __providerLabel;
  else el.textContent = "Wallet";
}

function walletIdFromInfo(info = {}, provider = {}) {
  const rdns = String(info.rdns || "").toLowerCase();
  const name = String(info.name || "").toLowerCase();
  if (provider.isRabby || rdns.includes("rabby") || name.includes("rabby")) return "rabby";
  if (provider.isOkxWallet || provider.isOKExWallet || rdns.includes("okx") || name.includes("okx")) return "okx";
  if (provider.isMetaMask || rdns.includes("metamask") || name.includes("metamask")) return "metamask";
  if (provider.isCoinbaseWallet || rdns.includes("coinbase") || name.includes("coinbase")) return "coinbase";
  if (rdns) return rdns;
  if (name) return name.replace(/\s+/g, "-");
  return "";
}

function walletNameFromId(id, info = {}) {
  if (info.name) return info.name;
  if (id === "metamask") return "MetaMask";
  if (id === "rabby") return "Rabby";
  if (id === "okx") return "OKX Wallet";
  if (id === "coinbase") return "Coinbase Wallet";
  return "Browser Wallet";
}

function providerSource(info = {}, fallback = "Injected") {
  if (info.rdns) return info.rdns;
  if (info.uuid) return "EIP-6963";
  return fallback;
}

function requestEip6963Providers() {
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch {
    // ignore
  }
}

async function collectWalletOptions() {
  requestEip6963Providers();
  await sleep(120);

  const options = [];
  const seenProviders = new WeakSet();
  const seenKnownIds = new Set();

  const addProvider = (provider, info = {}, fallbackSource = "Injected") => {
    if (!provider?.request || seenProviders.has(provider)) return;
    const baseId = walletIdFromInfo(info, provider);
    const knownId = ["metamask", "rabby", "okx", "coinbase"].includes(baseId) ? baseId : "";
    if (knownId && seenKnownIds.has(knownId)) return;
    seenProviders.add(provider);
    if (knownId) seenKnownIds.add(knownId);
    const id = baseId || `browser-wallet-${options.length + 1}`;
    options.push({
      id,
      label: walletNameFromId(id, info),
      source: providerSource(info, fallbackSource),
      provider,
    });
  };

  for (const { provider, info } of eip6963Providers.values()) {
    addProvider(provider, info, "EIP-6963");
  }

  const injected = window.ethereum;
  const injectedProviders = [];
  if (Array.isArray(injected?.providers)) injectedProviders.push(...injected.providers);
  if (injected?.request) injectedProviders.push(injected);
  for (const provider of injectedProviders) addProvider(provider, {}, "Extension");

  return options;
}

function openWalletDialog(options) {
  return new Promise((resolve, reject) => {
    const backdrop = document.getElementById("walletBackdrop");
    const list = document.getElementById("walletList");
    const close = document.getElementById("closeWallet");
    const help = document.getElementById("walletHelp");
    if (!backdrop || !list || !close) {
      reject(new Error("Wallet dialog unavailable"));
      return;
    }

    list.textContent = "";
    if (help) {
      help.textContent = options.length
        ? "Each detected wallet is listed once. Choose the wallet you want to use."
        : "No injected wallet was found. Open this page inside MetaMask, Rabby, OKX, or another Base-compatible wallet browser.";
    }

    const selectedId = localStorage.getItem("selectedWalletId") || "";

    for (const option of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "walletOption";
      if (selectedId && option.id === selectedId) btn.classList.add("selected");

      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = option.label;
      const source = document.createElement("span");
      source.textContent = option.source;
      text.append(name, source);

      const badge = document.createElement("span");
      badge.className = "walletBadge";
      badge.textContent = option.id === "okx" ? "OKX" : option.id;

      btn.append(text, badge);
      btn.addEventListener("click", () => {
        cleanup();
        resolve(option);
      });
      list.appendChild(btn);
    }

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      const title = document.createElement("h2");
      title.textContent = "No wallet detected";
      const copy = document.createElement("p");
      copy.className = "p";
      copy.textContent = "Use a wallet browser or enable one wallet extension for this site.";
      empty.append(title, copy);
      list.appendChild(empty);
    }

    const cleanup = () => {
      backdrop.classList.remove("show");
      backdrop.setAttribute("aria-hidden", "true");
      close.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdrop);
    };
    const onCancel = () => {
      cleanup();
      reject(new Error("Wallet selection cancelled"));
    };
    const onBackdrop = (event) => {
      if (event.target === backdrop) onCancel();
    };

    close.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdrop);
    backdrop.classList.add("show");
    backdrop.setAttribute("aria-hidden", "false");
  });
}

function resetWalletSession({ keepProvider = true } = {}) {
  __walletSession.provider = keepProvider ? __provider : null;
  __walletSession.from = null;
  __walletSession.ready = false;
  __walletSession.paymasterSupported = false;
  __walletSession.label = keepProvider ? __providerLabel : "";
  __account = null;
  __walletCaps = null;
  __walletCapsKey = "";
  if (!keepProvider) {
    __provider = null;
    __providerLabel = "";
    __providerId = "";
  }
  updateWalletStatus();
}

function bindProviderEvents(provider) {
  if (!provider?.on || providerEventBound.has(provider)) return;
  providerEventBound.add(provider);
  provider.on("accountsChanged", (accounts) => {
    const next = accounts?.[0] || null;
    __account = next;
    __walletSession.from = next;
    __walletSession.ready = !!next && __walletSession.ready;
    __walletCaps = null;
    __walletCapsKey = "";
    updateWalletStatus();
  });
  provider.on("chainChanged", () => {
    __walletSession.ready = false;
    __walletCaps = null;
    __walletCapsKey = "";
  });
}

async function chooseInjectedProvider({ forceChoice = false } = {}) {
  const options = await collectWalletOptions();
  const selectedId = localStorage.getItem("selectedWalletId");
  if (!forceChoice && selectedId) {
    const found = options.find((option) => option.id === selectedId);
    if (found) return found;
  }
  if (!forceChoice && options.length === 1) return options[0];

  const chosen = await openWalletDialog(options);
  localStorage.setItem("selectedWalletId", chosen.id);
  return chosen;
}

async function getProvider({ forceChoice = false } = {}) {
  if (__provider && !forceChoice) return __provider;
  const chosen = await chooseInjectedProvider({ forceChoice });
  __provider = chosen.provider;
  __providerLabel = chosen.label;
  __providerId = chosen.id;
  bindProviderEvents(__provider);
  updateWalletStatus();
  return __provider;
}

async function ensureConnected(provider) {
  if (__account) return __account;
  try {
    const existing = await provider.request({ method: "eth_accounts" });
    const addr = existing?.[0];
    if (addr) {
      __account = addr;
      updateWalletStatus();
      return __account;
    }
  } catch {
    // Some providers only support the interactive request.
  }

  if (!__connectInFlight) {
    __connectInFlight = (async () => {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const addr = accounts?.[0];
      if (!addr) throw new Error("No account selected");
      __account = addr;
      updateWalletStatus();
      return __account;
    })().finally(() => {
      __connectInFlight = null;
    });
  }
  return __connectInFlight;
}

async function ensureBaseMainnet(provider) {
  if (!__switchInFlight) {
    __switchInFlight = (async () => {
      const chainId = await provider.request({ method: "eth_chainId" });
      if (String(chainId).toLowerCase() === BASE_MAINNET_CHAIN_ID) return BASE_MAINNET_CHAIN_ID;

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE_MAINNET_CHAIN_ID }],
        });
      } catch (switchError) {
        const code = Number(switchError?.code);
        if (code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: BASE_MAINNET_CHAIN_ID,
              chainName: "Base",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            }],
          });
        } else {
          throw new Error("Please switch to Base Mainnet");
        }
      }

      const next = await provider.request({ method: "eth_chainId" });
      if (String(next).toLowerCase() !== BASE_MAINNET_CHAIN_ID) {
        throw new Error("Could not switch to Base Mainnet");
      }
      return BASE_MAINNET_CHAIN_ID;
    })().finally(() => {
      __switchInFlight = null;
    });
  }
  return __switchInFlight;
}

async function getWalletCapabilities(provider, userAddress) {
  const key = `${__providerId || "wallet"}:${userAddress || ""}`;
  if (__walletCaps && __walletCapsKey === key) return __walletCaps;
  try {
    __walletCaps = await provider.request({
      method: "wallet_getCapabilities",
      params: [userAddress],
    });
  } catch {
    __walletCaps = {};
  }
  __walletCapsKey = key;
  return __walletCaps;
}

function walletSupportsPaymaster(caps, chainIdHex) {
  return !!caps?.[chainIdHex]?.paymasterService?.supported;
}

async function initWalletSession({ forceChoice = false } = {}) {
  if (__walletSession.ready && !forceChoice) return __walletSession;
  if (forceChoice) resetWalletSession({ keepProvider: false });
  const provider = await getProvider({ forceChoice });
  const from = await ensureConnected(provider);
  await ensureBaseMainnet(provider);
  await loadRuntimeConfig();
  const caps = await getWalletCapabilities(provider, from);
  __walletSession.provider = provider;
  __walletSession.from = from;
  __walletSession.ready = true;
  __walletSession.label = __providerLabel;
  __walletSession.paymasterSupported = !!PAYMASTER_SERVICE_URL && walletSupportsPaymaster(caps, BASE_MAINNET_CHAIN_ID);
  updateWalletStatus();
  return __walletSession;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function isUserRejected(e) {
  const msg = String(e?.message || e || "").toLowerCase();
  return Number(e?.code) === 4001 || msg.includes("user rejected") || msg.includes("rejected") || msg.includes("denied");
}

async function maybeAttachPaymaster(provider, from, req) {
  await loadRuntimeConfig();
  if (!PAYMASTER_SERVICE_URL) return { attached: false, req };
  const caps = await getWalletCapabilities(provider, from);
  if (!walletSupportsPaymaster(caps, BASE_MAINNET_CHAIN_ID)) return { attached: false, req };

  req.capabilities = req.capabilities || {};
  req.capabilities.paymasterService = { url: PAYMASTER_SERVICE_URL };
  return { attached: true, req };
}

async function sendCallsWithPaymasterFallback(provider, from, req) {
  const request = clonePlain(req);
  const { attached } = await maybeAttachPaymaster(provider, from, request);

  try {
    return await provider.request({ method: "wallet_sendCalls", params: [request] });
  } catch (e) {
    if (isUserRejected(e)) throw e;
    if (attached) {
      try {
        if (request?.capabilities?.paymasterService) delete request.capabilities.paymasterService;
        return await provider.request({ method: "wallet_sendCalls", params: [request] });
      } catch (retryError) {
        if (isUserRejected(retryError)) throw retryError;
      }
    }
    throw e;
  }
}

async function sendCallsOrTransaction(provider, from, req, fallbackTx) {
  try {
    const response = await sendCallsWithPaymasterFallback(provider, from, req);
    return { type: "calls", id: response?.id || response };
  } catch (callsError) {
    if (isUserRejected(callsError)) throw callsError;
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...fallbackTx, from }],
    });
    return { type: "tx", hash };
  }
}

async function waitForCallBundleFinal(provider, bundleId, { timeoutMs = 60000, pollMs = 1000 } = {}) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Transaction pending too long");
    }
    try {
      const status = await provider.request({ method: "wallet_getCallsStatus", params: [bundleId] });
      const code = Number(status?.status);
      if (code >= 200 && code < 300) {
        const receipts = status?.receipts || [];
        const anyFailed = receipts.some((r) => String(r?.status || "").toLowerCase() === "0x0");
        if (anyFailed) throw new Error("Transaction reverted");
        return status;
      }
      if (code >= 400) throw new Error("Transaction failed");
    } catch (e) {
      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("method not found") || msg.includes("unsupported") || msg.includes("does not exist")) {
        await sleep(1500);
        return { status: 100 };
      }
    }
    await sleep(pollMs);
  }
}

async function waitForTransactionReceipt(provider, hash, { timeoutMs = 60000, pollMs = 1200 } = {}) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Transaction pending too long");
    }
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (String(receipt.status || "").toLowerCase() === "0x0") throw new Error("Transaction reverted");
      return receipt;
    }
    await sleep(pollMs);
  }
}

async function waitForSubmissionFinal(provider, submission) {
  if (submission?.type === "calls" && submission.id) {
    return waitForCallBundleFinal(provider, submission.id);
  }
  if (submission?.type === "tx" && submission.hash) {
    return waitForTransactionReceipt(provider, submission.hash);
  }
  await sleep(1200);
  return null;
}

let tapQueue = 0;
let tapSending = false;

function setTapHint(text) {
  const el = document.getElementById("hint");
  if (el) el.textContent = text;
}

async function walletSendCallsTap({ counter }) {
  const { provider, from, ready } = __walletSession.ready ? __walletSession : await initWalletSession();
  if (!ready) throw new Error("Wallet not ready");

  const actionId = bytes32FromAscii(ACTION_TAP);
  const data = uint256ToHex32(counter).replace(/^0x/, "0x");
  const calldata = abiEncodeLogAction(actionId, data);
  const reqId = `tap-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const req = {
    version: "2.0.0",
    id: reqId,
    from,
    chainId: BASE_MAINNET_CHAIN_ID,
    atomicRequired: false,
    calls: [{
      to: TAP_CONTRACT,
      value: "0x0",
      data: calldata,
    }],
    capabilities: {
      dataSuffix: {
        value: builderCodeSuffix,
        optional: true,
      },
    },
  };

  return sendCallsOrTransaction(provider, from, req, {
    to: TAP_CONTRACT,
    value: "0x0",
    data: calldata,
  });
}

async function processTapQueue() {
  if (tapSending || tapQueue <= 0) return;
  tapSending = true;
  try {
    if (!__walletSession.ready) {
      setTapHint("Connecting wallet");
      await initWalletSession();
    }

    while (tapQueue > 0) {
      const nextCounter = (Number(localStorage.getItem("tapCounter") || "0") || 0) + 1;
      setTapHint(`Confirm in wallet (${tapQueue})`);

      try {
        const submission = await withTimeout(walletSendCallsTap({ counter: nextCounter }), 60000);
        setTapHint("Pending onchain");
        await waitForSubmissionFinal(await getProvider(), submission);

        localStorage.setItem("tapCounter", String(nextCounter));
        pata += 1;
        store.setPata(pata);
        updateHud();
        tapQueue -= 1;
      } catch (e) {
        const msg = String(e?.message || e || "Transaction failed");
        if (isUserRejected(e)) {
          toast("Cancelled");
          tapQueue = Math.max(0, tapQueue - 1);
        } else if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("fund")) {
          toast("Not enough Base ETH for gas");
          tapQueue = 0;
        } else {
          toast(msg);
          tapQueue = Math.max(0, tapQueue - 1);
        }
      }

      setTapHint(tapQueue > 0 ? `Queued taps: ${tapQueue}` : "Tap");
      if (tapQueue > 0) await sleep(260);
    }
  } catch (e) {
    tapQueue = 0;
    toast(String(e?.message || e || "Wallet connection failed"));
  } finally {
    tapSending = false;
    if (tapQueue > 0) void processTapQueue();
    else setTapHint("Tap");
  }
}

function enqueueTapTx() {
  if (!isReadyToSend()) {
    toast("Tap contract address invalid");
    return;
  }
  tapQueue += 1;
  setTapHint(`Queued taps: ${tapQueue}`);
  void processTapQueue();
}

async function walletSendCallsUsdc({ usdString, recipient }) {
  if (!isHexAddress(USDC_CONTRACT)) throw new Error("Invalid USDC contract");
  if (!isHexAddress(recipient)) throw new Error("Invalid recipient address");

  const { provider, from } = await initWalletSession();
  await ensureBaseMainnet(provider);

  const units = parseUsdcToBaseUnits(usdString);
  const data = encodeErc20Transfer(recipient, units);
  const reqId = `usdc-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const req = {
    version: "2.0.0",
    id: reqId,
    from,
    chainId: BASE_MAINNET_CHAIN_ID,
    atomicRequired: false,
    calls: [{
      to: USDC_CONTRACT,
      value: "0x0",
      data,
    }],
    capabilities: {
      dataSuffix: {
        value: builderCodeSuffix,
        optional: true,
      },
    },
  };

  return sendCallsOrTransaction(provider, from, req, {
    to: USDC_CONTRACT,
    value: "0x0",
    data,
  });
}

const tipState = {
  status: "idle",
  usd: "1",
};

function setTipCta(text, disabled) {
  const btn = document.getElementById("tipCta");
  if (!btn) return;
  btn.textContent = text;
  btn.disabled = !!disabled;
}

function setPrepAnim(on) {
  document.getElementById("prepAnim")?.classList.toggle("show", !!on);
}

function resetTipUi() {
  tipState.status = "idle";
  setPrepAnim(false);
  setTipCta("Send USDC", false);
}

function selectPreset(button) {
  document.querySelectorAll(".preset").forEach((preset) => preset.classList.toggle("selected", preset === button));
}

function currentUsdValue() {
  return document.getElementById("customUsd")?.value.trim() || "1";
}

async function runTipFlow(usdString) {
  try {
    parseUsdcToBaseUnits(usdString);
  } catch (e) {
    toast(String(e?.message || e));
    return null;
  }

  tipState.usd = usdString;
  tipState.status = "preparing";
  setTipCta("Preparing", true);
  setPrepAnim(true);

  try {
    tipState.status = "wallet";
    setTipCta("Confirm in wallet", true);
    const submission = await walletSendCallsUsdc({ usdString, recipient: TIP_RECIPIENT });

    tipState.status = "sending";
    setTipCta("Sending", true);
    await waitForSubmissionFinal(await getProvider(), submission);

    tipState.status = "done";
    setPrepAnim(false);
    setTipCta("Send again", false);
    toast("Tip sent");
    return submission;
  } catch (e) {
    setPrepAnim(false);
    resetTipUi();
    if (isUserRejected(e)) toast("Cancelled");
    else toast(String(e?.message || e || "Transaction failed"));
    return null;
  }
}

async function runEarnFlow() {
  setEarnButtonState("Preparing", true);
  try {
    parseUsdcToBaseUnits("1");
    setEarnButtonState("Confirm in wallet", true);
    const submission = await walletSendCallsUsdc({ usdString: "1", recipient: TIP_RECIPIENT });
    setEarnButtonState("Earning", true);
    await waitForSubmissionFinal(await getProvider(), submission);

    pata += 10000;
    energy = 100;
    store.setPata(pata);
    store.setEnergy(energy);
    updateHud();

    toast("Earned +10,000 Pata");
  } catch (e) {
    if (isUserRejected(e)) toast("Cancelled");
    else toast(String(e?.message || e || "Transaction failed"));
  } finally {
    setEarnButtonState("Earn with 1 USDC", false);
  }
}

function setEarnButtonState(text, disabled) {
  const btn = document.getElementById("earnBtn");
  if (!btn) return;
  btn.textContent = text;
  btn.disabled = !!disabled;
}

function wireUi() {
  updateHud();
  startEnergyRegen();
  setTapHint("Tap");
  updateWalletStatus();

  const tapArea = document.getElementById("tapArea");
  tapArea?.addEventListener("pointerdown", onTap, { passive: true });

  document.getElementById("walletBtn")?.addEventListener("click", async () => {
    try {
      await initWalletSession({ forceChoice: true });
      toast("Wallet connected");
    } catch (e) {
      if (!String(e?.message || "").toLowerCase().includes("cancelled")) {
        toast(String(e?.message || e || "Wallet connection failed"));
      }
    }
  });

  document.getElementById("navGame")?.addEventListener("click", () => showPanel("game"));
  document.getElementById("navEarn")?.addEventListener("click", () => showPanel("earn"));
  document.getElementById("navTip")?.addEventListener("click", () => showPanel("tip"));

  document.getElementById("closeSheet")?.addEventListener("click", () => showPanel("game"));
  document.getElementById("sheetBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "sheetBackdrop") showPanel("game");
  });

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-usd") || "1";
      const input = document.getElementById("customUsd");
      if (input) input.value = value;
      selectPreset(button);
      resetTipUi();
    });
  });

  document.getElementById("customUsd")?.addEventListener("input", () => {
    document.querySelectorAll(".preset").forEach((preset) => preset.classList.remove("selected"));
    resetTipUi();
  });

  document.getElementById("tipCta")?.addEventListener("click", async () => {
    if (tipState.status === "done") {
      resetTipUi();
      return;
    }
    await runTipFlow(currentUsdValue());
  });

  document.getElementById("earnBtn")?.addEventListener("click", async () => {
    await runEarnFlow();
  });

  resetTipUi();
  setEarnButtonState("Earn with 1 USDC", false);
  showPanel("game");
}

window.addEventListener("load", async () => {
  await loadRuntimeConfig();
  wireUi();
});
