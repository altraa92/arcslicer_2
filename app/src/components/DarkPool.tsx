// src/components/DarkPool.tsx
// ──────────────────────────────────────────────────────────────────
// Main UI — two panels:
//   Left  → Whale: deposit + init encrypted vault
//   Right → Buyer: submit encrypted buy order, see decrypted fill
// Plus a devnet faucet button at the top.
// ──────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useDepositVault } from "../hooks/useDepositVault";
import { useSecureBuy } from "../hooks/useSecureBuy";
import { useFaucet } from "../hooks/useFaucet";
import idl from "../idl/arcslicer_2.json";

// ── helpers ───────────────────────────────────────────────────────
const fmt = (n: bigint, dec = 6) =>
  (Number(n) / 10 ** dec).toLocaleString(undefined, { maximumFractionDigits: 4 });

const LABEL: Record<string, string> = {
  idle:       "Ready",
  encrypting: "Encrypting client-side…",
  sending:    "Submitting to Solana…",
  waiting:    "MPC nodes computing in the dark…",
  done:       "Confirmed ✓",
  error:      "Error",
};

// ── component ─────────────────────────────────────────────────────
export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program,  setProgram]  = useState<anchor.Program<any> | null>(null);

  // Whale form
  const [mintAddr,      setMintAddr]      = useState("");
  const [targetMint,    setTargetMint]    = useState("");
  const [depositorAta,  setDepositorAta]  = useState("");
  const [depositAmt,    setDepositAmt]    = useState("");
  const [priceAmt,      setPriceAmt]      = useState("");
  const [urgency,       setUrgency]       = useState<1|2|3>(2);

  // Buyer form
  const [parentKey,    setParentKey]   = useState("");
  const [buyAmt,       setBuyAmt]      = useState("");
  const [maxPriceAmt,  setMaxPriceAmt] = useState("");

  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    const prov = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, connection]);

  const { deposit,   status: dStatus, txSig: dSig, error: dErr } = useDepositVault(program, provider);
  const { submitBuy, status: bStatus, txSig: bSig, fillResult, error: bErr } = useSecureBuy(program, provider);
  const { requestAirdrop, isDropping, faucetLog } = useFaucet();

  const handleDeposit = () => {
    if (!provider || !depositAmt || !priceAmt || !mintAddr) return;
    deposit({
      depositAmount:         BigInt(Math.round(parseFloat(depositAmt) * 1e6)),
      pricePerToken:         BigInt(Math.round(parseFloat(priceAmt)   * 1e6)),
      urgencyLevel:          urgency,
      mint:                  new PublicKey(mintAddr),
      targetMint:            new PublicKey(targetMint),
      depositorTokenAccount: new PublicKey(depositorAta),
    });
  };

  const handleBuy = () => {
    if (!provider || !parentKey || !buyAmt || !maxPriceAmt) return;
    submitBuy({
      slicerParentKey: new PublicKey(parentKey),
      amountRequested: BigInt(Math.round(parseFloat(buyAmt)       * 1e6)),
      maxPrice:        BigInt(Math.round(parseFloat(maxPriceAmt)  * 1e6)),
    });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600&family=Syne:wght@700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#080c10;--surface:#0d1318;--border:#1a2530;
          --cyan:#00e5ff;--cyan-dim:#00e5ff22;
          --gold:#f0c040;--gold-dim:#f0c04018;
          --ember:#ff4d4d;--green:#40e080;
          --txt:#c8d8e8;--muted:#4a6070;
          --mono:'JetBrains Mono',monospace;--display:'Syne',sans-serif;
        }
        body{background:var(--bg);color:var(--txt);font-family:var(--mono);font-size:14px}
        .shell{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:2rem 1rem 4rem}
        /* header */
        .hdr{width:100%;max-width:1120px;display:flex;align-items:center;justify-content:space-between;padding-bottom:1.5rem;border-bottom:1px solid var(--border);margin-bottom:2rem}
        .logo{font-family:var(--display);font-size:1.4rem;font-weight:800;color:var(--cyan);letter-spacing:-.02em}
        .logo span{color:var(--muted);font-weight:700}
        .logo-sub{font-size:.55rem;letter-spacing:.18em;color:var(--muted);margin-top:.1rem}
        /* faucet bar */
        .faucet-bar{width:100%;max-width:1120px;display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding:.75rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:3px}
        .faucet-log{font-size:.7rem;color:var(--muted);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        /* grid */
        .grid{width:100%;max-width:1120px;display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
        @media(max-width:720px){.grid{grid-template-columns:1fr}}
        /* card */
        .card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1.75rem;position:relative;overflow:hidden}
        .card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);opacity:.7}
        .card.buyer::before{background:linear-gradient(90deg,transparent,var(--gold),transparent)}
        .card-label{font-size:.55rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
        .card-title{font-family:var(--display);font-size:1.1rem;font-weight:800;color:var(--txt);margin:.2rem 0 1.25rem}
        .badge{display:inline-block;font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;padding:.2rem .5rem;border-radius:2px;background:var(--cyan-dim);color:var(--cyan);margin-bottom:1rem}
        .buyer .badge{background:var(--gold-dim);color:var(--gold)}
        /* fields */
        .field{margin-bottom:.9rem}
        .field label{display:block;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem}
        .field input,.field select{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:3px;color:var(--txt);font-family:var(--mono);font-size:.8rem;padding:.5rem .7rem;outline:none;transition:border-color .15s}
        .field input:focus,.field select:focus{border-color:var(--cyan);box-shadow:0 0 0 2px var(--cyan-dim)}
        .buyer .field input:focus,.buyer .field select:focus{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold-dim)}
        .field select option{background:var(--surface)}
        .row-2{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
        /* buttons */
        .btn{width:100%;margin-top:.5rem;padding:.7rem;background:transparent;border:1px solid var(--cyan);border-radius:3px;color:var(--cyan);font-family:var(--mono);font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:all .15s}
        .btn:hover:not(:disabled){background:var(--cyan-dim);box-shadow:0 0 10px var(--cyan-dim)}
        .btn:disabled{opacity:.3;cursor:not-allowed}
        .btn.gold{border-color:var(--gold);color:var(--gold)}
        .btn.gold:hover:not(:disabled){background:var(--gold-dim);box-shadow:0 0 10px var(--gold-dim)}
        .btn.sm{width:auto;padding:.45rem .9rem;margin-top:0;font-size:.65rem}
        /* status */
        .status{margin-top:.85rem;padding:.55rem .7rem;border-radius:3px;font-size:.68rem;background:var(--bg);border:1px solid var(--border);color:var(--muted);display:flex;align-items:center;gap:.5rem}
        .status.active{color:var(--cyan);border-color:var(--cyan-dim)}
        .status.done{color:var(--green);border-color:#40e08030}
        .status.error{color:var(--ember);border-color:#ff4d4d30}
        /* fill result */
        .fill-box{margin-top:.85rem;padding:.9rem;border:1px solid var(--gold);border-radius:3px;background:var(--gold-dim)}
        .fill-row{display:flex;gap:1.5rem;flex-wrap:wrap}
        .fill-label{font-size:.55rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.15rem}
        .fill-val{font-family:var(--display);font-size:1.2rem;font-weight:800;color:var(--gold)}
        /* tx sig */
        .sig{font-size:.6rem;color:var(--muted);word-break:break-all;margin-top:.4rem}
        .sig a{color:var(--muted);text-decoration:underline}
        /* spinner */
        .spin{width:9px;height:9px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;flex-shrink:0}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div className="shell">

        {/* ── Header ── */}
        <header className="hdr">
          <div>
            <div className="logo">DARK<span>POOL</span></div>
            <div className="logo-sub">POWERED BY ARCIUM MPC · SOLANA DEVNET</div>
          </div>
          <WalletMultiButton />
        </header>

        {/* ── Faucet bar ── */}
        <div className="faucet-bar">
          <button
            className="btn sm"
            onClick={requestAirdrop}
            disabled={isDropping || !wallet.publicKey}
          >
            {isDropping ? "Dropping…" : "🪂 Get Devnet Tokens"}
          </button>
          <span className="faucet-log">{faucetLog || "0.2 SOL · 500 USDC · 0.5 wSOL"}</span>
        </div>

        {/* ── Main grid ── */}
        <div className="grid">

          {/* LEFT — Whale */}
          <div className="card">
            <div className="card-label">Role: Seller</div>
            <div className="card-title">Deposit &amp; Init Vault</div>
            <div className="badge">encrypted with arcium mpc</div>

            <div className="field">
              <label>Token Mint (selling)</label>
              <input value={mintAddr} onChange={e => setMintAddr(e.target.value)} placeholder="So11111…" />
            </div>
            <div className="field">
              <label>Target Mint (want in return)</label>
              <input value={targetMint} onChange={e => setTargetMint(e.target.value)} placeholder="EPje…" />
            </div>
            <div className="field">
              <label>Your Token Account (ATA)</label>
              <input value={depositorAta} onChange={e => setDepositorAta(e.target.value)} placeholder="Your associated token account" />
            </div>
            <div className="row-2">
              <div className="field">
                <label>Deposit Amount</label>
                <input type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder="1000" />
              </div>
              <div className="field">
                <label>Price Per Token</label>
                <input type="number" value={priceAmt} onChange={e => setPriceAmt(e.target.value)} placeholder="0.50" />
              </div>
            </div>
            <div className="field">
              <label>Urgency Level</label>
              <select value={urgency} onChange={e => setUrgency(+e.target.value as 1|2|3)}>
                <option value={1}>1 — Stealth (slow, minimal footprint)</option>
                <option value={2}>2 — Standard</option>
                <option value={3}>3 — Aggressive (fast fills)</option>
              </select>
            </div>

            <button
              className="btn"
              onClick={handleDeposit}
              disabled={!wallet.publicKey || !depositAmt || !priceAmt || !mintAddr || dStatus === "sending" || dStatus === "waiting"}
            >
              Encrypt &amp; Deposit
            </button>

            {dStatus !== "idle" && (
              <div className={`status ${dStatus === "done" ? "done" : dStatus === "error" ? "error" : "active"}`}>
                {dStatus !== "done" && dStatus !== "error" && <span className="spin" />}
                {LABEL[dStatus]}{dErr ? ` — ${dErr}` : ""}
              </div>
            )}
            {dSig && (
              <p className="sig">tx: <a href={`https://explorer.solana.com/tx/${dSig}?cluster=devnet`} target="_blank" rel="noreferrer">{dSig.slice(0,20)}…</a></p>
            )}
          </div>

          {/* RIGHT — Buyer */}
          <div className="card buyer">
            <div className="card-label">Role: Buyer</div>
            <div className="card-title">Submit Dark Order</div>
            <div className="badge">order encrypted · matched in the dark</div>

            <div className="field">
              <label>Vault (SlicerParent PDA)</label>
              <input value={parentKey} onChange={e => setParentKey(e.target.value)} placeholder="Parent PDA address" />
            </div>
            <div className="row-2">
              <div className="field">
                <label>Amount to Buy</label>
                <input type="number" value={buyAmt} onChange={e => setBuyAmt(e.target.value)} placeholder="100" />
              </div>
              <div className="field">
                <label>Max Price Per Token</label>
                <input type="number" value={maxPriceAmt} onChange={e => setMaxPriceAmt(e.target.value)} placeholder="0.55" />
              </div>
            </div>

            <button
              className="btn gold"
              onClick={handleBuy}
              disabled={!wallet.publicKey || !parentKey || !buyAmt || !maxPriceAmt || bStatus === "sending" || bStatus === "waiting"}
            >
              Encrypt &amp; Submit Order
            </button>

            {bStatus !== "idle" && (
              <div className={`status ${bStatus === "done" ? "done" : bStatus === "error" ? "error" : "active"}`}>
                {bStatus !== "done" && bStatus !== "error" && <span className="spin" />}
                {LABEL[bStatus]}{bErr ? ` — ${bErr}` : ""}
              </div>
            )}

            {fillResult && (
              <div className="fill-box">
                <div className="fill-row">
                  <div>
                    <div className="fill-label">Filled Amount</div>
                    <div className="fill-val">{fmt(fillResult.filledAmount)}</div>
                  </div>
                  <div>
                    <div className="fill-label">Total Cost</div>
                    <div className="fill-val">{fmt(fillResult.cost)}</div>
                  </div>
                </div>
              </div>
            )}

            {bSig && (
              <p className="sig">tx: <a href={`https://explorer.solana.com/tx/${bSig}?cluster=devnet`} target="_blank" rel="noreferrer">{bSig.slice(0,20)}…</a></p>
            )}
          </div>

        </div>
      </div>
    </>
  );
}