/**
 * DarkPool.tsx — ArcSlicer UI
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
import { PROGRAM_ID } from "../config/constants";
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

const fmtSol = (n: bigint) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " SOL";

// Cost from circuit = fill_lamports × price_micro_usdc
// Both are scaled: lamports (1e9) × micro_usdc (1e6) = 1e15
const fmtCost = (costRaw: bigint) =>
  "$" + (Number(costRaw) / 1e15).toLocaleString(undefined, { maximumFractionDigits: 4 });

// Effective price per SOL = cost_raw / 1e15 / (fill_lamports / 1e9)
const fmtEffectivePrice = (costRaw: bigint, filledLamports: bigint): string => {
  if (filledLamports === 0n) return "—";
  const pricePerSol = (Number(costRaw) / 1e15) / (Number(filledLamports) / 1e9);
  return "$" + pricePerSol.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " / SOL";
};

const shortKey = (k: PublicKey) => {
  const s = k.toBase58();
  return s.slice(0, 5) + "…" + s.slice(-4);
};

type View = "market" | "sell" | "manage";

// ── SVG Icons ─────────────────────────────────────────────────────

const IconMarket = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1" y="8" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
    <rect x="6" y="5" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.7"/>
    <rect x="11" y="2" width="3" height="12" rx="0.5" fill="currentColor"/>
  </svg>
);
const IconSell = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M7.5 1v9M4 7l3.5 3.5L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 12h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const IconVault = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M7.5 5.5V4M7.5 11v-1M5.5 7.5H4M11 7.5H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);
const IconFaucet = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M5 3h5M6 3V1.5M9 3V1.5M4 6h7l-1 7H5L4 6z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7.5 9v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);
const IconLock = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="2" y="5.5" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 5.5V4a2.5 2.5 0 015 0v1.5" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="6.5" cy="8.5" r="1" fill="currentColor"/>
  </svg>
);
const IconArrow = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2.5 6.5h8M7 3l3.5 3.5L7 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconClose = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 2l9 9M11 2L2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const IconExternal = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M5 2H2a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <path d="M7 1h3v3M10 1L5.5 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M1.5 5.5L4 8l5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M11 6.5A4.5 4.5 0 112 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M11 3v3.5H7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program,  setProgram]  = useState<anchor.Program<any> | null>(null);
  const [view,     setView]     = useState<View>("market");

  const [vaults,        setVaults]        = useState<VaultEntry[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);
  const [selectedVault, setSelectedVault] = useState<VaultEntry | null>(null);

  const [depositSol,   setDepositSol]   = useState("");
  const [priceUsdc,    setPriceUsdc]    = useState("");
  const [urgency,      setUrgency]      = useState<1 | 2 | 3>(2);

  const [buyAmtSol,    setBuyAmtSol]    = useState("");
  const [maxPriceUsdc, setMaxPriceUsdc] = useState("");

  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    const prov = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  const cipher = useArciumCipher(provider, program ? PROGRAM_ID : null);

  const { deposit, status: dStatus, txSig: dSig, error: dErr, getParentPda } =
    useDepositVault(program, provider, cipher);

  const { submitBuy, status: bStatus, txSig: bSig, fillResult, error: bErr } =
    useSecureBuy(program, provider, cipher);

  const { requestAirdrop, isDropping, faucetLog } = useFaucet();

  // ── Fetch vaults ──────────────────────────────────────────────
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

  // Auto-fetch on mount and view change
  useEffect(() => {
    if (program && view === "market") fetchVaults();
  }, [program, view, fetchVaults]);

  // Re-fetch after buy completes so vault balance updates
  useEffect(() => {
    if (bStatus === "done" && program) fetchVaults();
  }, [bStatus, program, fetchVaults]);

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
  const depositBusy  = ["sending", "waiting", "encrypting"].includes(dStatus);
  const buyBusy      = ["sending", "waiting", "encrypting"].includes(bStatus);

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
          <div className="wallet-frame"><WalletMultiButton /></div>
        </div>
      </header>

      {/* ── Nav ── */}
      <nav className="pool-nav">
        {([
          { key: "market", label: "Market",   icon: <IconMarket /> },
          { key: "sell",   label: "Sell SOL", icon: <IconSell />   },
          { key: "manage", label: "My Vault", icon: <IconVault />  },
        ] as { key: View; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
          <button
            key={key}
            className={`nav-tab ${view === key ? "active" : ""}`}
            onClick={() => setView(key)}
          >
            {icon}<span>{label}</span>
          </button>
        ))}
        <button
          className="nav-tab faucet-tab"
          onClick={requestAirdrop}
          disabled={isDropping || !wallet.publicKey}
        >
          <IconFaucet /><span>{isDropping ? "Funding…" : "Devnet Funds"}</span>
        </button>
        {faucetLog && <span className="faucet-log">{faucetLog}</span>}
      </nav>

      {/* ══════════════════════════════════════════════════════════
          MARKET VIEW
      ══════════════════════════════════════════════════════════ */}
      {view === "market" && (
        <section className="market-view">
          <div className="market-header">
            <div>
              <h2>Active Vaults</h2>
              <p className="market-sub">
                Each vault holds a seller's SOL at a hidden floor price. Submit your max — the
                MPC cluster privately checks if prices cross. You only pay if filled.
              </p>
            </div>
            <button className="refresh-btn" onClick={fetchVaults} disabled={loadingVaults}>
              <IconRefresh />
              <span>{loadingVaults ? "Loading…" : "Refresh"}</span>
            </button>
          </div>

          {!wallet.publicKey && (
            <div className="connect-prompt">Connect your wallet to view and trade.</div>
          )}
          {wallet.publicKey && vaults.length === 0 && !loadingVaults && (
            <div className="empty-state">
              No active vaults. Go to <strong>Sell SOL</strong> to create the first one.
            </div>
          )}

          <div className="vault-grid">
            {vaults.map(vault => {
              const isOwn    = wallet.publicKey?.toBase58() === vault.owner.toBase58();
              const isActive = selectedVault?.pubkey.toBase58() === vault.pubkey.toBase58();
              const filled   = vault.totalDeposit > 0n
                ? vault.totalDeposit - vault.remainingBalance : 0n;
              const fillPct  = vault.totalDeposit > 0n
                ? Math.round(Number(filled * 100n / vault.totalDeposit)) : 0;

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
                      <small>Total</small>
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
                    <code>{shortKey(vault.pubkey)}</code>
                    {!isOwn && (
                      <span className="select-hint">
                        {isActive ? <><IconCheck /> Selected</> : <>Select <IconArrow /></>}
                      </span>
                    )}
                    {isOwn && <span className="own-hint">Manage in My Vault</span>}
                  </div>
                </article>
              );
            })}
          </div>

          {/* ── Buy panel ── */}
          {selectedVault && (
            <div className="buy-panel">
              <div className="buy-panel-header">
                <h3>Buy from {shortKey(selectedVault.pubkey)}</h3>
                <button className="close-btn" onClick={() => setSelectedVault(null)}>
                  <IconClose />
                </button>
              </div>

              <div className="how-it-works">
                <IconLock />
                <span>
                  Your max price is encrypted locally before submission. The seller's floor is also
                  encrypted. The MPC cluster checks privately if they cross — neither party ever
                  sees the other's number. Fill or no fill, your price stays hidden.
                </span>
              </div>

              <div className="available-info">
                <span>Available in vault</span>
                <strong>{fmtSol(selectedVault.remainingBalance)}</strong>
              </div>

              <div className="field-stack">
                <label className="control-field">
                  <span>SOL amount to buy</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={buyAmtSol}
                    onChange={e => setBuyAmtSol(e.target.value)}
                    placeholder={`up to ${(Number(selectedVault.remainingBalance) / 1e9).toFixed(3)}`}
                  />
                </label>
                <label className="control-field">
                  <span>Max price you'll pay (USDC per SOL)</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={maxPriceUsdc}
                    onChange={e => setMaxPriceUsdc(e.target.value)}
                    placeholder="e.g. 155.00"
                  />
                  <small className="field-hint">
                    Encrypted before leaving your browser.
                  </small>
                </label>
              </div>

              <button
                className="action-button buyer-action"
                onClick={handleBuy}
                disabled={!wallet.publicKey || !buyAmtSol || !maxPriceUsdc || buyBusy}
              >
                {buyBusy ? "Processing…" : "Encrypt & submit order"}
              </button>

              {bStatus !== "idle" && <StepTracker status={bStatus} error={bErr} />}

              {fillResult && (
                <div className="fill-result">
                  <div className={`fill-result-header ${fillResult.filledAmount > 0n ? "filled" : "no-fill"}`}>
                    {fillResult.filledAmount > 0n
                      ? <><IconCheck /> Order filled</>
                      : <>No fill — your price didn't cross the seller's floor</>
                    }
                  </div>
                  {fillResult.filledAmount > 0n && (
                    <div className="fill-metrics">
                      <div>
                        <small>You received</small>
                        <strong>{fmtSol(fillResult.filledAmount)}</strong>
                      </div>
                      <div>
                        <small>You paid</small>
                        <strong>{fmtCost(fillResult.cost)}</strong>
                      </div>
                      <div>
                        <small>Effective price</small>
                        <strong>{fmtEffectivePrice(fillResult.cost, fillResult.filledAmount)}</strong>
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
          SELL VIEW
      ══════════════════════════════════════════════════════════ */}
      {view === "sell" && (
        <section className="sell-view">
          <div className="view-header">
            <h2>Create a private vault</h2>
            <p>
              Deposit SOL and set a hidden floor price. Buyers see your vault size
              but never your price. The MPC cluster matches privately.
            </p>
          </div>

          <div className="explainer-steps">
            {[
              { n: "1", title: "Deposit SOL + set a hidden floor price", body: "Your minimum price is encrypted before leaving your browser. Nobody sees it." },
              { n: "2", title: "Buyers see your vault size, not your price", body: "They submit their own max price — also encrypted." },
              { n: "3", title: "MPC cluster matches privately", body: "If buyer max ≥ your floor, fill happens. Neither party sees the other's number." },
              { n: "4", title: "Withdraw unsold SOL anytime", body: "Track fill progress and withdraw remainder in My Vault." },
            ].map(s => (
              <div key={s.n} className="ex-step">
                <span className="ex-num">{s.n}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
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
                <span>Minimum price (USDC per SOL)</span>
                <input
                  type="number" min="0" step="0.01"
                  value={priceUsdc}
                  onChange={e => setPriceUsdc(e.target.value)}
                  placeholder="e.g. 150.00"
                />
                <small className="field-hint">
                  <IconLock /> Encrypted before sending. Buyers cannot see this.
                </small>
              </label>
              <label className="control-field">
                <span>Fill urgency</span>
                <select value={urgency} onChange={e => setUrgency(Number(e.target.value) as 1 | 2 | 3)}>
                  <option value={1}>Stealth — slower, quieter</option>
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
              {depositBusy ? "Processing…" : "Encrypt & deposit"}
            </button>

            {dStatus !== "idle" && <StepTracker status={dStatus} error={dErr} />}

            {dStatus === "done" && myVault && (
              <div className="vault-created">
                <strong><IconCheck /> Vault created</strong>
                <p>Visible to buyers in the Market tab. Track fills in My Vault.</p>
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
          MANAGE VIEW
      ══════════════════════════════════════════════════════════ */}
      {view === "manage" && (
        <section className="manage-view">
          <div className="view-header">
            <h2>My Vault</h2>
            <p>Track fill status and withdraw unsold SOL.</p>
          </div>

          {!wallet.publicKey && (
            <div className="connect-prompt">Connect your wallet to manage your vault.</div>
          )}
          {wallet.publicKey && !myVaultEntry && (
            <div className="empty-state">
              No active vault. Go to <strong>Sell SOL</strong> to create one.
            </div>
          )}

          {myVaultEntry && (() => {
            const filled  = myVaultEntry.totalDeposit - myVaultEntry.remainingBalance;
            const fillPct = myVaultEntry.totalDeposit > 0n
              ? Math.round(Number(filled * 100n / myVaultEntry.totalDeposit)) : 0;
            return (
              <div className="manage-card">
                <div className="manage-row">
                  <span>Total deposited</span>
                  <strong>{fmtSol(myVaultEntry.totalDeposit)}</strong>
                </div>
                <div className="manage-row">
                  <span>Remaining</span>
                  <strong>{fmtSol(myVaultEntry.remainingBalance)}</strong>
                </div>
                <div className="manage-row">
                  <span>Filled</span>
                  <strong>{fmtSol(filled)}</strong>
                </div>
                <div className="manage-row">
                  <span>Fill rate</span>
                  <strong>{fillPct}%</strong>
                </div>
                <div className="fill-bar-wrap large" style={{ marginTop: "1rem" }}>
                  <div className="fill-bar">
                    <div className="fill-bar-inner" style={{ width: `${fillPct}%` }} />
                  </div>
                </div>
                <div className="manage-note">
                  <IconLock /> Your price floor is encrypted on-chain. Nobody can read it
                  without the MXE private key — not even after the vault is settled.
                </div>
                <button
                  className="action-button withdraw-action"
                  disabled={myVaultEntry.remainingBalance === 0n}
                >
                  {myVaultEntry.remainingBalance === 0n
                    ? "Nothing to withdraw"
                    : `Withdraw ${fmtSol(myVaultEntry.remainingBalance)}`}
                </button>
              </div>
            );
          })()}
        </section>
      )}
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function StepTracker({ status, error }: { status: string; error?: string | null }) {
  const steps = [
    { key: "encrypting", label: "Encrypt locally"  },
    { key: "sending",    label: "Send to Solana"   },
    { key: "waiting",    label: "MPC computing"    },
    { key: "done",       label: "Complete"         },
  ];
  const currentIdx = steps.findIndex(s => s.key === status);

  return (
    <div className="step-tracker">
      {steps.map((step, i) => {
        const isDone   = status === "done" ? true : i < currentIdx;
        const isActive = status !== "done" && i === currentIdx;
        return (
          <div key={step.key} className={`step-item ${isDone ? "done" : isActive ? "active" : "pending"}`}>
            <div className="step-dot">
              {isDone ? <IconCheck /> : isActive ? <span className="dot-pulse" /> : <span>{i + 1}</span>}
            </div>
            <span>{step.label}</span>
            {i < steps.length - 1 && <div className="step-connector" />}
          </div>
        );
      })}
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
      View on Solana Explorer <IconExternal />
    </a>
  );
}