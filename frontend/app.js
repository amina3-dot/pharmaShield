const { address: ADDRESS, chainId: CHAIN_ID, deployBlock } = window.PHARMA_CONFIG;
const SEPOLIA_HEX = "0x" + CHAIN_ID.toString(16);
const EXPLORER = "https://sepolia.etherscan.io";
const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const ABI = [
  "function registerBatch(bytes32 batchId, bytes32 certHash)",
  "function registerPackage(bytes32 packageId, bytes32 batchId, bytes32 metadataHash)",
  "function transferPackage(bytes32 packageId, address to)",
  "function acceptPackage(bytes32 packageId)",
  "function dispensePackage(bytes32 packageId)",
  "function recallBatch(bytes32 batchId)",
  "function verifyPackage(bytes32 packageId) view returns (uint8 status, address custodian, bytes32 batchId)",
  "event PackageRegistered(bytes32 indexed packageId, bytes32 indexed batchId, address indexed manufacturer)",
  "event TransferInitiated(bytes32 indexed packageId, address indexed from, address indexed to)",
  "event TransferAccepted(bytes32 indexed packageId, address indexed by)",
  "event PackageDispensed(bytes32 indexed packageId, address indexed pharmacy)",
  "event SuspiciousScan(bytes32 indexed packageId, uint8 indexed ruleId, address indexed reporter, bytes32 locationHash)"
];
const STATUS = ["UNKNOWN", "REGISTERED", "INTRANSIT", "RECEIVED", "DISPENSED", "RECALLED"];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const h = (t) => ethers.id(t.trim());
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

const reader = new ethers.Contract(ADDRESS, ABI, new ethers.JsonRpcProvider(PUBLIC_RPC));
let writer = null;

$("#ctr").textContent = ADDRESS;
$("#ctr").href = `${EXPLORER}/address/${ADDRESS}`;

function show(html, err) {
  const s = $("#status");
  s.hidden = false; s.className = "status" + (err ? " err" : ""); s.innerHTML = html;
}

async function connect() {
  if (!window.ethereum) return show("No wallet found. Install MetaMask to send transactions.", true);
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    let net = await provider.getNetwork();
    if (net.chainId !== BigInt(CHAIN_ID)) {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] }); }
      catch { $("#net").textContent = "Wrong network"; return show("Please switch MetaMask to the Sepolia test network.", true); }
      net = await new ethers.BrowserProvider(window.ethereum).getNetwork();
    }
    const p2 = new ethers.BrowserProvider(window.ethereum);
    const signer = await p2.getSigner();
    writer = new ethers.Contract(ADDRESS, ABI, signer);
    $("#net").textContent = "Sepolia";
    $("#acct").textContent = short(await signer.getAddress());
    $("#connect").textContent = "Connected";
    show("Wallet connected.");
  } catch (e) { show(e.code === "ACTION_REJECTED" || e.code === 4001 ? "Wallet connection was rejected." : esc(e.shortMessage || e.message), true); }
}

async function run(label, fn) {
  if (!writer) return show("Connect your wallet first.", true);
  try {
    show(`${label}: confirm in MetaMask…`);
    const tx = await fn();
    show(`${label}: submitted. <a target="_blank" rel="noopener" href="${EXPLORER}/tx/${tx.hash}">View on Etherscan</a>`);
    await tx.wait();
    show(`${label}: confirmed ✔ <a target="_blank" rel="noopener" href="${EXPLORER}/tx/${tx.hash}">View on Etherscan</a>`);
    return true;
  } catch (e) {
    const msg = e.code === "ACTION_REJECTED" ? "You rejected the signature." : (e.reason || e.shortMessage || e.message);
    show(`${label} failed: ${esc(msg)}`, true);
  }
}

async function verify() {
  const id = $("#vId").value.trim(); if (!id) return;
  const out = $("#vOut"); out.innerHTML = '<div class="res">Reading the ledger…</div>';
  try {
    const [st, cust, batch] = await reader.verifyPackage(h(id));
    const name = STATUS[Number(st)];
    let hist = [];
    const f = [["Registered", reader.filters.PackageRegistered(h(id))], ["Transfer offered", reader.filters.TransferInitiated(h(id))],
      ["Transfer accepted", reader.filters.TransferAccepted(h(id))], ["Dispensed", reader.filters.PackageDispensed(h(id))],
      ["Suspicious scan reported", reader.filters.SuspiciousScan(h(id))]];
    for (const [label, flt] of f) {
      for (const ev of await reader.queryFilter(flt, deployBlock)) hist.push({ label, b: ev.blockNumber, tx: ev.transactionHash });
    }
    hist.sort((a, b) => a.b - b.b);
    const label = name === "UNKNOWN" ? "UNKNOWN" : name === "RECALLED" ? "RECALLED" : (name === "INTRANSIT" ? "INTRANSIT" : "VERIFIED");
    out.innerHTML = `<div class="res"><span class="badge ${label}">${label === "INTRANSIT" ? "IN TRANSIT" : label}</span>
      <p>On-chain state: <b>${name}</b>${name === "UNKNOWN" ? "" : ` · Custodian: <b>${short(cust)}</b>`}</p>
      ${hist.length ? "<ul>" + hist.map((x) => `<li>${esc(x.label)} · block ${x.b} · <a target="_blank" rel="noopener" href="${EXPLORER}/tx/${x.tx}">tx</a></li>`).join("") + "</ul>" : ""}</div>`;
  } catch (e) { out.innerHTML = `<div class="res">Could not read the contract. Check config.js and your network. ${esc(e.shortMessage || e.message)}</div>`; }
}

$("#connect").onclick = connect;
$("#vBtn").onclick = verify;
$("#regBtn").onclick = async () => {
  const batch = h($("#bId").value);
  const ids = $("#pIds").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return show("Enter at least one package ID.", true);
  if (!(await run("registerBatch", () => writer.registerBatch(batch, h($("#cert").value))))) return;
  for (const id of ids) if (!(await run("registerPackage " + id, () => writer.registerPackage(h(id), batch, h("meta:" + id))))) return;
};
$("#trBtn").onclick = () => {
  if (!ethers.isAddress($("#to").value)) return show("Enter a valid recipient address.", true);
  run("transferPackage", () => writer.transferPackage(h($("#cId").value), $("#to").value));
};
$("#acBtn").onclick = () => run("acceptPackage", () => writer.acceptPackage(h($("#cId").value)));
$("#diBtn").onclick = () => run("dispensePackage", () => writer.dispensePackage(h($("#cId").value)));
$("#rcBtn").onclick = () => run("recallBatch", () => writer.recallBatch(h($("#rId").value)));
if (window.ethereum) window.ethereum.on?.("chainChanged", () => location.reload());
