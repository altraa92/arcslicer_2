/**
 * DarkPool.tsx
 *
 * Clean two-panel UI: Seller deposits SOL, Buyer submits encrypted order.
 * No manual address pasting — everything is derived automatically.
 * Cipher is created ONCE here and passed to both hooks.
 */

import { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useArciumCipher } from "../hooks/useArciumCipher";
import { useDepositVault } from "../hooks/useDepositVault";
import { useSecureBuy } from "../hooks/useSecureBuy";
import { useFaucet } from "../hooks/useFaucet";
import { PROGRAM_ID } from "../config/constants";
import idl from "../idl/arcslicer_2.json";

// ── Formatting helpers ────────────────────────────────────────────

/** Format lamports as SOL (9 decimals) */
const fmtSol = (n: bigint) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " SOL";

/** Format USDC micro-units (6 decimals) */
const fmtUsdc = (n: bigint) =>
  "$" + (Number(n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

const LABEL: Record<string, string> = {
  idle:       "Ready",
  encrypting: "Encrypting locally",
  sending:    "Submitting to Solana",
  waiting:    "MPC cluster computing",
  done:       "Confirmed",
  error:      "Error",
};

// ── Component ─────────────────────────────────────────────────────

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program,  setProgram]  = useState<anchor.Program<any> | null>(null);

  // ── Provider + program setup ──────────────────────────────────
  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    const prov = new anchor.AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  // ── Single cipher session shared by both hooks ────────────────
  // This is the fix: one keypair, one shared secret, consistent encryption.
  const cipher = useArciumCipher(provider, program ? PROGRAM_ID : null);

  // ── Hooks ─────────────────────────────────────────────────────
  const {
    deposit,
    status:     dStatus,
    txSig:      dSig,
    error:      dErr,
    getParentPda,
  } = useDepositVault(program, provider, cipher);

  const {
    submitBuy,
    status:     bStatus,
    txSig:      bSig,
    fillResult,
    error:      bErr,
  } = useSecureBuy(program, provider, cipher);

  const { requestAirdrop, isDropping, faucetLog } = useFaucet();

  // ── Seller state ──────────────────────────────────────────────
  const [depositSol,   setDepositSol]   = useState("");
  const [priceUsdc,    setPriceUsdc]    = useState("");
  const [urgency,      setUrgency]      = useState<1 | 2 | 3>(2);

  // ── Buyer state ───────────────────────────────────────────────
  const [parentKey,    setParentKey]    = useState("");
  const [buyAmtSol,    setBuyAmtSol]    = useState("");
  const [maxPriceUsdc, setMaxPriceUsdc] = useState("");

  // ── Handlers ──────────────────────────────────────────────────
  const handleDeposit = () => {
    if (!provider || !depositSol || !priceUsdc) return;
    deposit({
      depositLamports: BigInt(Math.round(parseFloat(depositSol) * 1e9)),
      pricePerToken:   BigInt(Math.round(parseFloat(priceUsdc)  * 1e6)),
      urgencyLevel:    urgency,
    });
  };

  const handleBuy = () => {
    if (!provider || !parentKey || !buyAmtSol || !maxPriceUsdc) return;
    submitBuy({
      slicerParentKey: new PublicKey(parentKey),
      amountRequested: BigInt(Math.round(parseFloat(buyAmtSol)    * 1e9)),
      maxPrice:        BigInt(Math.round(parseFloat(maxPriceUsdc) * 1e6)),
    });
  };

  // Show the vault PDA after a successful deposit so seller can share it
  const parentPda = getParentPda();

  const depositBusy = ["sending", "waiting", "encrypting"].includes(dStatus);
  const buyBusy     = ["sending", "waiting", "encrypting"].includes(bStatus);

  return (
    <main className="darkpool-shell">
      <div className="market-grid"  aria-hidden="true" />
      <div className="orb orb-a"    aria-hidden="true" />
      <div className="orb orb-b"    aria-hidden="true" />

      {/* ── Header ── */}
      <header className="command-header">
        <div className="brand-lockup">
          <span className="eyebrow">Arcium MPC desk</span>
          <h1>Arc<span>Slicer</span></h1>
          <p>
            Private SOL→USDC order flow. Amounts and prices encrypt locally
            before leaving your browser. Matching runs inside Arcium — nobody
            sees your numbers.
          </p>
        </div>
        <div className="header-console">
          <div className="signal-card">
            <span>Pair</span>
            <strong>SOL / USDC</strong>
          </div>
          <div className="signal-card">
            <span>Execution</span>
            <strong>Dark pool</strong>
          </div>
          <div className="wallet-frame">
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* ── Faucet rail ── */}
      <section className="liquidity-rail" aria-label="Devnet faucet">
        <div>
          <span className="rail-kicker">Devnet liquidity</span>
          <p>{faucetLog || "Request SOL + USDC for testing"}</p>
        </div>
        <button
          className="action-button rail-button"
          onClick={requestAirdrop}
          disabled={isDropping || !wallet.publicKey}
        >
          {isDropping ? "Funding…" : "Request devnet funds"}
        </button>
      </section>

      {/* ── Main panels ── */}
      <section className="deal-board" aria-label="Dark pool actions">

        {/* ── Panel 01: Seller ── */}
        <article className="trade-panel seller-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">01</span>
              <h2>Sell SOL privately</h2>
            </div>
            <span className="tech-pill">Enc&lt;Shared&gt; → Enc&lt;Mxe&gt;</span>
          </div>

          <p className="panel-copy">
            Set how much SOL you want to sell and your minimum USDC price per SOL.
            Your price is encrypted before it touches the network — buyers never
            see it until after a match.
          </p>

          <div className="field-stack">
            <label className="control-field">
              <span>Amount to sell (SOL)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={depositSol}
                onChange={(e) => setDepositSol(e.target.value)}
                placeholder="e.g. 10"
              />
            </label>

            <label className="control-field">
              <span>Minimum price (USDC per SOL)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={priceUsdc}
                onChange={(e) => setPriceUsdc(e.target.value)}
                placeholder="e.g. 150.00"
              />
            </label>

            <label className="control-field">
              <span>Fill urgency</span>
              <select
                value={urgency}
                onChange={(e) => setUrgency(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>Stealth — slower, quieter</option>
                <option value={2}>Standard — balanced</option>
                <option value={3}>Aggressive — fastest fill</option>
              </select>
            </label>
          </div>

          <button
            className="action-button seller-action"
            onClick={handleDeposit}
            disabled={!wallet.publicKey || !depositSol || !priceUsdc || depositBusy}
          >
            Encrypt and deposit
          </button>

          {dStatus !== "idle" && <StatusLine status={dStatus} error={dErr} />}
          {dSig && <TxLink signature={dSig} />}

          {/* Show vault PDA after success so seller can share with buyers */}
          {dStatus === "done" && parentPda && (
            <div className="vault-address-card">
              <span>Share this vault address with buyers:</span>
              <code
                title="Click to copy"
                onClick={() => navigator.clipboard.writeText(parentPda.toBase58())}
              >
                {parentPda.toBase58()}
              </code>
              <small>Click to copy</small>
            </div>
          )}
        </article>

        {/* ── Panel 02: Buyer ── */}
        <article className="trade-panel buyer-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">02</span>
              <h2>Buy SOL privately</h2>
            </div>
            <span className="tech-pill amber">Enc&lt;Shared&gt; match</span>
          </div>

          <p className="panel-copy">
            Enter the vault address shared by the seller, how much SOL you want,
            and the most you'll pay in USDC per SOL. The cluster privately checks
            if the prices cross — your order is never exposed.
          </p>

          <div className="field-stack compact-stack">
            <label className="control-field">
              <span>Vault address (from seller)</span>
              <input
                value={parentKey}
                onChange={(e) => setParentKey(e.target.value)}
                placeholder="Paste vault address here"
              />
            </label>

            <div className="split-fields">
              <label className="control-field">
                <span>Amount wanted (SOL)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={buyAmtSol}
                  onChange={(e) => setBuyAmtSol(e.target.value)}
                  placeholder="e.g. 2"
                />
              </label>

              <label className="control-field">
                <span>Max price (USDC per SOL)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxPriceUsdc}
                  onChange={(e) => setMaxPriceUsdc(e.target.value)}
                  placeholder="e.g. 155.00"
                />
              </label>
            </div>
          </div>

          <button
            className="action-button buyer-action"
            onClick={handleBuy}
            disabled={!wallet.publicKey || !parentKey || !buyAmtSol || !maxPriceUsdc || buyBusy}
          >
            Encrypt and submit order
          </button>

          {bStatus !== "idle" && <StatusLine status={bStatus} error={bErr} tone="brass" />}

          {fillResult && (
            <div className="fill-ledger">
              <span>Decrypted fill report</span>
              <div className="fill-metrics">
                <div>
                  <small>Filled</small>
                  <strong>{fmtSol(fillResult.filledAmount)}</strong>
                </div>
                <div>
                  <small>Cost</small>
                  <strong>{fmtUsdc(fillResult.cost)}</strong>
                </div>
                <div>
                  <small>Vault remaining</small>
                  <strong>{fmtSol(fillResult.newVaultBalance)}</strong>
                </div>
              </div>
            </div>
          )}

          {bSig && <TxLink signature={bSig} />}
        </article>
      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────

type StatusLineProps = {
  status: string;
  error?: string | null;
  tone?: "sand" | "brass";
};

function StatusLine({ status, error, tone = "sand" }: StatusLineProps) {
  const stateClass =
    status === "done"  ? "is-done"  :
    status === "error" ? "is-error" :
    `is-active ${tone}`;

  return (
    <div className={`status-line ${stateClass}`}>
      {status !== "done" && status !== "error" && <span className="status-spinner" />}
      <span>{LABEL[status] || status}</span>
      {error && <em>{error}</em>}
    </div>
  );
}

function TxLink({ signature }: { signature: string }) {
  return (
    <p className="tx-link">
      tx:{" "}
      <a
        href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
        target="_blank"
        rel="noreferrer"
      >
        {signature.slice(0, 20)}…
      </a>
    </p>
  );
}