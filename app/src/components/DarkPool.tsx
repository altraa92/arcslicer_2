/**
 * DarkPool.tsx — ArcSlicer UI
 *
 * Three views:
 *   "market"  — vault listings, buyer picks a vault and submits order
 *   "sell"    — seller deposits SOL, sets hidden price
 *   "manage"  — seller sees their vault status, can withdraw
 *
 * Cipher created once here, passed to both hooks.
 */

import { useState, useEffect, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useArciumCipher } from "../hooks/useArciumCipher";
import { useDepositVault } from "../hooks/useDepositVault";
import { useSecureBuy } from "../hooks/useSecureBuy";
import { useFaucet } from "../hooks/useFaucet";
import { PROGRAM_ID, WSOL_MINT } from "../config/constants";
import idl from "../idl/arcslicer_2.json";

// ── Types ─────────────────────────────────────────────────────────

interface VaultEntry {
  pubkey:           PublicKey;
  owner:            PublicKey;
  totalDeposit:     bigint;
  remainingBalance: bigint;
  isWithdrawn:      boolean;
  urgencyLevel:     number;
}

// ── Helpers ───────────────────────────────────────────────────────

const fmtSol  = (n: bigint) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 }) + " SOL";
const fmtUsdc = (n: bigint) =>
  "$" + (Number(n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
const shortKey = (k: PublicKey) => {
  const s = k.toBase58();
  return s.slice(0, 4) + "…" + s.slice(-4);
};

const STEP_LABELS: Record<string, string> = {
  idle:       "—",
  encrypting: "Encrypting locally…",
  sending:    "Sending to Solana…",
  waiting:    "MPC cluster computing…",
  done:       "Complete",
  error:      "Error",
};

type View = "market" | "sell" | "manage";

// ── Component ─────────────────────────────────────────────────────

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program,  setProgram]  = useState<anchor.Program<any> | null>(null);
  const [view,     setView]     = useState<View>("market");

  // ── Vault list state ──────────────────────────────────────────
  const [vaults,        setVaults]        = useState<VaultEntry[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);
  const [selectedVault, setSelectedVault] = useState<VaultEntry | null>(null);

  // ── Sell form ─────────────────────────────────────────────────
  const [depositSol,   setDepositSol]   = useState("");
  const [priceUsdc,    setPriceUsdc]    = useState("");
  const [urgency,      setUrgency]      = useState<1 | 2 | 3>(2);

  // ── Buy form ──────────────────────────────────────────────────
  const [buyAmtSol,    setBuyAmtSol]    = useState("");
  const [maxPriceUsdc, setMaxPriceUsdc] = useState("");

  // ── Provider + program ────────────────────────────────────────
  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    const prov = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  // ── Cipher (single session for both hooks) ────────────────────
  const cipher = useArciumCipher(provider, program ? PROGRAM_ID : null);

  const {
    deposit, status: dStatus, txSig: dSig, error: dErr, getParentPda,
  } = useDepositVault(program, provider, cipher);

  const {
    submitBuy, status: bStatus, txSig: bSig, fillResult, error: bErr,
  } = useSecureBuy(program, provider, cipher);

  const { requestAirdrop, isDropping, faucetLog } = useFaucet();

  // ── Fetch all vaults ──────────────────────────────────────────
  const fetchVaults = useCallback(async () => {
    if (!program) return;
    setLoadingVaults(true);
    try {
      const accounts = await (program.account as any).slicerParent.all();
      const entries: VaultEntry[] = accounts
        .filter((a: any) => !a.account.isWithdrawn)
        .map((a: any) => ({
          pubkey:           a.publicKey,
          owner:            a.account.owner,
          totalDeposit:     BigInt(a.account.totalDeposit.toString()),
          remainingBalance: BigInt(a.account.remainingBalance.toString()),
          isWithdrawn:      a.account.isWithdrawn,
          urgencyLevel:     a.account.urgencyLevel,
        }));
      setVaults(entries);
    } catch (e) {
      console.error("Failed to fetch vaults:", e);
    } finally {
      setLoadingVaults(false);
    }
  }, [program]);

  useEffect(() => {
    if (program && view === "market") fetchVaults();
  }, [program, view, fetchVaults]);

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
    if (!provider || !selectedVault || !buyAmtSol || !maxPriceUsdc) return;
    submitBuy({
      slicerParentKey: selectedVault.pubkey,
      amountRequested: BigInt(Math.round(parseFloat(buyAmtSol)    * 1e9)),
      maxPrice:        BigInt(Math.round(parseFloat(maxPriceUsdc) * 1e6)),
    });
  };

  const myVault = getParentPda();
  const myVaultEntry = vaults.find(v => myVault && v.pubkey.toBase58() === myVault.toBase58());

  const depositBusy = ["sending", "waiting", "encrypting"].includes(dStatus);
  const buyBusy     = ["sending", "waiting", "encrypting"].includes(bStatus);

  // ── Render ────────────────────────────────────────────────────
  return (
    <main className="darkpool-shell">
      <div className="market-grid"  aria-hidden="true" />
      <div className="orb orb-a"    aria-hidden="true" />
      <div className="orb orb-b"    aria-hidden="true" />

      {/* ── Header ── */}
      <header className="command-header">
        <div className="brand-lockup">
          <span className="eyebrow">Arcium MPC · Solana Devnet</span>
          <h1>Arc<span>Slicer</span></h1>
          <p>Private SOL/USDC dark pool. Prices never leave your browser unencrypted.</p>
        </div>
        <div className="header-console">
          <div className="wallet-frame">
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* ── Nav ── */}
      <nav className="pool-nav">
        {(["market", "sell", "manage"] as View[]).map(v => (
          <button
            key={v}
            className={`nav-tab ${view === v ? "active" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "market"  && "🏦 Market"}
            {v === "sell"    && "📥 Sell SOL"}
            {v === "manage"  && "⚙️ My Vault"}
          </button>
        ))}
        <button
          className="nav-tab faucet-tab"
          onClick={requestAirdrop}
          disabled={isDropping || !wallet.publicKey}
        >
          {isDropping ? "Funding…" : "🪙 Devnet Funds"}
        </button>
        {faucetLog && <span className="faucet-log">{faucetLog}</span>}
      </nav>

      {/* ══════════════════════════════════════════════════════════
          VIEW: MARKET — vault listings + buy panel
      ══════════════════════════════════════════════════════════ */}
      {view === "market" && (
        <section className="market-view">
          <div className="market-header">
            <div>
              <h2>Active Vaults</h2>
              <p className="market-sub">
                Each vault is a seller's private SOL offer. Prices are hidden — submit
                your max and the MPC cluster privately checks if it crosses the seller's floor.
                You only pay if you're filled.
              </p>
            </div>
            <button className="refresh-btn" onClick={fetchVaults} disabled={loadingVaults}>
              {loadingVaults ? "Loading…" : "↺ Refresh"}
            </button>
          </div>

          {!wallet.publicKey && (
            <div className="connect-prompt">Connect your wallet to view and buy from vaults.</div>
          )}

          {wallet.publicKey && vaults.length === 0 && !loadingVaults && (
            <div className="empty-state">
              No active vaults on devnet yet. Be the first — go to <strong>Sell SOL</strong> to create one.
            </div>
          )}

          <div className="vault-grid">
            {vaults.map(vault => {
              const isOwn    = wallet.publicKey?.toBase58() === vault.owner.toBase58();
              const isActive = selectedVault?.pubkey.toBase58() === vault.pubkey.toBase58();
              const fillPct  = vault.totalDeposit > 0n
                ? Math.round(Number((vault.totalDeposit - vault.remainingBalance) * 100n / vault.totalDeposit))
                : 0;

              return (
                <article
                  key={vault.pubkey.toBase58()}
                  className={`vault-card ${isOwn ? "own-vault" : ""} ${isActive ? "selected" : ""}`}
                  onClick={() => !isOwn && setSelectedVault(isActive ? null : vault)}
                >
                  <div className="vault-card-top">
                    <span className="vault-label">
                      {isOwn ? "Your vault" : `Vault ${shortKey(vault.pubkey)}`}
                    </span>
                    <span className={`urgency-badge u${vault.urgencyLevel}`}>
                      {vault.urgencyLevel === 1 ? "Stealth" : vault.urgencyLevel === 2 ? "Standard" : "Aggressive"}
                    </span>
                  </div>

                  <div className="vault-amounts">
                    <div>
                      <small>Available</small>
                      <strong>{fmtSol(vault.remainingBalance)}</strong>
                    </div>
                    <div>
                      <small>Total deposited</small>
                      <strong>{fmtSol(vault.totalDeposit)}</strong>
                    </div>
                  </div>

                  <div className="fill-bar-wrap">
                    <div className="fill-bar">
                      <div className="fill-bar-inner" style={{ width: `${fillPct}%` }} />
                    </div>
                    <span>{fillPct}% filled</span>
                  </div>

                  <div className="vault-card-footer">
                    <code title={vault.pubkey.toBase58()}>{shortKey(vault.pubkey)}</code>
                    {!isOwn && (
                      <span className="select-hint">
                        {isActive ? "✓ Selected" : "Click to select"}
                      </span>
                    )}
                    {isOwn && (
                      <span className="own-hint">Switch to My Vault to manage</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* ── Buy panel — shows when a vault is selected ── */}
          {selectedVault && (
            <div className="buy-panel">
              <div className="buy-panel-header">
                <h3>Buy from vault {shortKey(selectedVault.pubkey)}</h3>
                <button className="close-btn" onClick={() => setSelectedVault(null)}>✕</button>
              </div>

              <div className="how-it-works">
                <strong>How this works:</strong> Enter what you want to pay (max price) and how much SOL.
                The MPC cluster privately checks if your price crosses the seller's hidden floor.
                If it does, you're filled. If not, you get nothing and pay only gas.
                The seller never knows your price. You never know theirs.
              </div>

              <div className="available-info">
                <span>Available in this vault:</span>
                <strong>{fmtSol(selectedVault.remainingBalance)}</strong>
              </div>

              <div className="field-stack">
                <label className="control-field">
                  <span>How much SOL do you want?</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={buyAmtSol}
                    onChange={e => setBuyAmtSol(e.target.value)}
                    placeholder={`Max ${(Number(selectedVault.remainingBalance) / 1e9).toFixed(3)}`}
                  />
                </label>
                <label className="control-field">
                  <span>Your max price (USDC per SOL)</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={maxPriceUsdc}
                    onChange={e => setMaxPriceUsdc(e.target.value)}
                    placeholder="e.g. 155.00"
                  />
                  <small className="field-hint">
                    This is encrypted before leaving your browser. The seller cannot see it.
                  </small>
                </label>
              </div>

              <button
                className="action-button buyer-action"
                onClick={handleBuy}
                disabled={!wallet.publicKey || !buyAmtSol || !maxPriceUsdc || buyBusy}
              >
                {buyBusy ? STEP_LABELS[bStatus] : "Encrypt & submit order"}
              </button>

              {bStatus !== "idle" && (
                <StepTracker status={bStatus} error={bErr} />
              )}

              {fillResult && (
                <div className="fill-result">
                  <div className="fill-result-header">
                    {fillResult.filledAmount > 0n ? "✓ Order filled" : "✗ No fill — price didn't cross"}
                  </div>
                  {fillResult.filledAmount > 0n && (
                    <div className="fill-metrics">
                      <div><small>You received</small><strong>{fmtSol(fillResult.filledAmount)}</strong></div>
                      <div><small>You paid</small><strong>{fmtUsdc(fillResult.cost)}</strong></div>
                      <div>
                        <small>Effective price</small>
                        <strong>
                          {fillResult.filledAmount > 0n
                            ? fmtUsdc(fillResult.cost * BigInt(1e9) / fillResult.filledAmount) + " / SOL"
                            : "—"}
                        </strong>
                      </div>
                    </div>
                  )}
                  {bSig && <TxLink signature={bSig} />}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════
          VIEW: SELL — create a vault
      ══════════════════════════════════════════════════════════ */}
      {view === "sell" && (
        <section className="sell-view">
          <div className="view-header">
            <h2>Create a private vault</h2>
            <p>
              Deposit SOL and set your minimum USDC price per SOL. Your price is encrypted
              before it leaves your browser — buyers never see your floor. They submit their
              max price, and the MPC cluster privately determines if there's a match.
            </p>
          </div>

          <div className="explainer-steps">
            <div className="ex-step">
              <span className="ex-num">1</span>
              <div>
                <strong>You deposit SOL + set a hidden floor price</strong>
                <p>E.g. "10 SOL, min 150 USDC/SOL" — encrypted, nobody sees this</p>
              </div>
            </div>
            <div className="ex-step">
              <span className="ex-num">2</span>
              <div>
                <strong>Buyers see your vault size (not your price)</strong>
                <p>They submit their own max price encrypted</p>
              </div>
            </div>
            <div className="ex-step">
              <span className="ex-num">3</span>
              <div>
                <strong>MPC cluster privately matches</strong>
                <p>If buyer max ≥ your floor → fill. Neither party sees the other's price.</p>
              </div>
            </div>
            <div className="ex-step">
              <span className="ex-num">4</span>
              <div>
                <strong>Withdraw unsold SOL anytime</strong>
                <p>Check My Vault tab to see fill status and withdraw remainder</p>
              </div>
            </div>
          </div>

          <div className="trade-panel seller-panel">
            <div className="field-stack">
              <label className="control-field">
                <span>SOL to deposit</span>
                <input
                  type="number" min="0" step="0.1"
                  value={depositSol}
                  onChange={e => setDepositSol(e.target.value)}
                  placeholder="e.g. 10"
                />
              </label>
              <label className="control-field">
                <span>Your minimum price (USDC per SOL)</span>
                <input
                  type="number" min="0" step="0.01"
                  value={priceUsdc}
                  onChange={e => setPriceUsdc(e.target.value)}
                  placeholder="e.g. 150.00"
                />
                <small className="field-hint">
                  Encrypted before sending. Buyers cannot see this number.
                </small>
              </label>
              <label className="control-field">
                <span>Fill urgency</span>
                <select value={urgency} onChange={e => setUrgency(Number(e.target.value) as 1 | 2 | 3)}>
                  <option value={1}>Stealth — slower, quieter execution</option>
                  <option value={2}>Standard — balanced</option>
                  <option value={3}>Aggressive — fastest fill attempts</option>
                </select>
              </label>
            </div>

            <button
              className="action-button seller-action"
              onClick={handleDeposit}
              disabled={!wallet.publicKey || !depositSol || !priceUsdc || depositBusy}
            >
              {depositBusy ? STEP_LABELS[dStatus] : "Encrypt & deposit"}
            </button>

            {dStatus !== "idle" && <StepTracker status={dStatus} error={dErr} />}

            {dStatus === "done" && myVault && (
              <div className="vault-created">
                <strong>✓ Vault created</strong>
                <p>Your vault is now visible to buyers in the Market tab. Go to <strong>My Vault</strong> to track fills.</p>
                <div className="vault-address-card">
                  <span>Vault address</span>
                  <code onClick={() => navigator.clipboard.writeText(myVault.toBase58())}>
                    {myVault.toBase58()}
                  </code>
                  <small>Click to copy</small>
                </div>
                {dSig && <TxLink signature={dSig} />}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════
          VIEW: MANAGE — seller's vault dashboard
      ══════════════════════════════════════════════════════════ */}
      {view === "manage" && (
        <section className="manage-view">
          <div className="view-header">
            <h2>My Vault</h2>
            <p>Track your vault's fill status and withdraw any unsold SOL.</p>
          </div>

          {!wallet.publicKey && (
            <div className="connect-prompt">Connect your wallet to manage your vault.</div>
          )}

          {wallet.publicKey && !myVaultEntry && (
            <div className="empty-state">
              You don't have an active vault yet. Go to <strong>Sell SOL</strong> to create one.
            </div>
          )}

          {myVaultEntry && (
            <div className="manage-card">
              <div className="manage-row">
                <span>Total deposited</span>
                <strong>{fmtSol(myVaultEntry.totalDeposit)}</strong>
              </div>
              <div className="manage-row">
                <span>Remaining (unsold)</span>
                <strong>{fmtSol(myVaultEntry.remainingBalance)}</strong>
              </div>
              <div className="manage-row">
                <span>Filled</span>
                <strong>{fmtSol(myVaultEntry.totalDeposit - myVaultEntry.remainingBalance)}</strong>
              </div>
              <div className="manage-row">
                <span>Fill rate</span>
                <strong>
                  {myVaultEntry.totalDeposit > 0n
                    ? Math.round(Number((myVaultEntry.totalDeposit - myVaultEntry.remainingBalance) * 100n / myVaultEntry.totalDeposit))
                    : 0}%
                </strong>
              </div>

              <div className="fill-bar-wrap large">
                <div className="fill-bar">
                  <div
                    className="fill-bar-inner"
                    style={{
                      width: myVaultEntry.totalDeposit > 0n
                        ? `${Math.round(Number((myVaultEntry.totalDeposit - myVaultEntry.remainingBalance) * 100n / myVaultEntry.totalDeposit))}%`
                        : "0%"
                    }}
                  />
                </div>
              </div>

              <div className="manage-note">
                Your price floor is stored encrypted on-chain. Even after the vault is settled,
                nobody can read it without your private key.
              </div>

              <button
                className="action-button withdraw-action"
                disabled={myVaultEntry.remainingBalance === 0n}
                onClick={() => {/* withdraw_remainder TODO */}}
              >
                {myVaultEntry.remainingBalance === 0n
                  ? "Nothing to withdraw"
                  : `Withdraw ${fmtSol(myVaultEntry.remainingBalance)}`}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function StepTracker({ status, error }: { status: string; error?: string | null }) {
  const steps = ["encrypting", "sending", "waiting", "done"];
  const currentIdx = steps.indexOf(status);

  return (
    <div className="step-tracker">
      {steps.map((step, i) => (
        <div
          key={step}
          className={`step-item ${i < currentIdx ? "done" : i === currentIdx ? "active" : "pending"}`}
        >
          <div className="step-dot">
            {i < currentIdx ? "✓" : i === currentIdx && status !== "done" ? <span className="dot-pulse" /> : i + 1}
          </div>
          <span>{step === "encrypting" ? "Encrypt locally" : step === "sending" ? "Send to Solana" : step === "waiting" ? "MPC computing" : "Complete"}</span>
        </div>
      ))}
      {status === "error" && error && <div className="step-error">{error}</div>}
    </div>
  );
}

function TxLink({ signature }: { signature: string }) {
  return (
    <a
      className="tx-link"
      href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
    >
      View on Solana Explorer ↗
    </a>
  );
}