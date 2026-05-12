import React, { useState, useEffect, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useArciumCipher } from "../hooks/useArciumCipher";
import { useDepositVault } from "../hooks/useDepositVault";
import { useSecureBuy } from "../hooks/useSecureBuy";
import { useFaucet } from "../hooks/useFaucet";
import { PROGRAM_ID, USDC_MINT } from "../config/constants";
import idl from "../idl/arcslicer_2.json";

interface VaultEntry {
  pubkey: PublicKey;
  owner: PublicKey;
  totalDeposit: bigint;
  remainingBalance: bigint;
  isWithdrawn: boolean;
  urgencyLevel: number;
  filledAmount: bigint;
}

interface PurchaseRecord {
  vaultKey: string;
  filledAmount: bigint;
  cost: bigint;
  txSig: string;
  timestamp: number;
}

const fmtSol = (n: bigint) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }) +
  " SOL";

const fmtStatSol = (n: bigint) => (n === 0n ? "—" : fmtSol(n));
const fmtStatNumber = (n: number) => (n === 0 ? "—" : n.toString());
const getFilledAmount = (total: bigint, remaining: bigint) =>
  total > remaining ? total - remaining : 0n;
const getFillPct = (total: bigint, remaining: bigint) => {
  if (total <= 0n) return 0;
  const filled = getFilledAmount(total, remaining);
  const pct = Number((filled * 10000n) / total) / 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

const fmtCost = (raw: bigint) =>
  "$" +
  (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });

const fmtEffectivePrice = (cost: bigint, filled: bigint): string => {
  if (filled === 0n) return "-";
  const price = Number(cost) / 1e6 / (Number(filled) / 1e9);
  return (
    "$" +
    price.toLocaleString(undefined, { maximumFractionDigits: 4 }) +
    " / SOL"
  );
};

const shortKey = (k: PublicKey | string) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return s.slice(0, 5) + "..." + s.slice(-4);
};

type View = "market" | "sell" | "manage" | "history";

const IconFaucet = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M4.5 3h5M5.5 3V1.5M8.5 3V1.5M3.5 6h7L9.5 13h-5L3.5 6z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconLock = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect
      x="1.5"
      y="5"
      width="9"
      height="6.5"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.1"
    />
    <path
      d="M3.5 5V3.5a2.5 2.5 0 015 0V5"
      stroke="currentColor"
      strokeWidth="1.1"
    />
    <circle cx="6" cy="8" r="1" fill="currentColor" />
  </svg>
);
const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path
      d="M1.5 5.5L4 8l5.5-5.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconExternal = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M4.5 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V5.5"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
    <path
      d="M6.5 1h2.5v2.5M9 1L5 5"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 2l8 8M10 2L2 10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);
const IconArrow = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path
      d="M2 6h8M7 3l3 3-3 3"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconStatusDot = () => (
  <svg className="status-dot" width="6" height="6" viewBox="0 0 6 6">
    <circle cx="3" cy="3" r="3" fill="currentColor" />
  </svg>
);
const IconWallet = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M2 4.2h10a1 1 0 011 1v5.3a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5a1 1 0 011-1h8.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 7.8h3"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect
      x="4"
      y="4"
      width="7"
      height="7"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.1"
    />
    <path
      d="M2 8.5V2.8a.8.8 0 01.8-.8h5.7"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
    />
  </svg>
);
const IconRefresh = ({ spinning = false }: { spinning?: boolean }) => (
  <svg
    className={spinning ? "refresh-icon is-spinning" : "refresh-icon"}
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
  >
    <path
      d="M10 6A4 4 0 112.9 3.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M2.5 1.7v2.4h2.4"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconVaultEmpty = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
    <rect
      x="10"
      y="16"
      width="28"
      height="22"
      rx="3"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path
      d="M17 16v-3a7 7 0 0114 0v3"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <circle cx="24" cy="27" r="5" stroke="currentColor" strokeWidth="1" />
    <path
      d="M24 22v10M19 27h10"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

const SLICER_PARENT_LEN =
  8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 1 + 1 + 32 + 32 + 16 + 1; // 244

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program, setProgram] = useState<anchor.Program<any> | null>(null);
  const [view, setView] = useState<View>("market");

  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);
  const [selectedVault, setSelectedVault] = useState<VaultEntry | null>(null);

  const [depositSol, setDepositSol] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("");
  const [urgency, setUrgency] = useState<1 | 2 | 3>(2);
  const [buyAmtSol, setBuyAmtSol] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [maxPriceUsdc, setMaxPriceUsdc] = useState("");

  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);

  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;
    const prov = new anchor.AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  const cipher = useArciumCipher(provider, program ? PROGRAM_ID : null);

  const {
    deposit,
    withdraw,
    status: dStatus,
    txSig: dSig,
    error: dErr,
    getParentPda,
  } = useDepositVault(program, provider, cipher);

  const {
    submitBuy,
    status: bStatus,
    txSig: bSig,
    fillResult,
    error: bErr,
  } = useSecureBuy(program, provider, cipher);

  const {
    requestAirdrop,
    isDropping,
    faucetLog,
  } = useFaucet();

  const fetchVaults = useCallback(async () => {
    if (!program) return;
    setLoadingVaults(true);
    try {
      const rawParents = await program.provider.connection.getProgramAccounts(
        program.programId,
        {
          filters: [{ dataSize: SLICER_PARENT_LEN }],
        }
      );

      const parentAccounts = rawParents.flatMap(({ pubkey, account }) => {
        try {
          const decoded = program.coder.accounts.decode(
            "slicerParent",
            account.data
          );
          return [{ publicKey: pubkey, account: decoded }];
        } catch {
          return [];
        }
      });

      const entries: VaultEntry[] = parentAccounts
        .filter((a: any) => !a.account.isWithdrawn)
        .map((a: any) => {
          const totalDeposit = BigInt(a.account.totalDeposit.toString());
          const remainingBalance = BigInt(
            a.account.remainingBalance.toString()
          );
          const filledAmount = getFilledAmount(totalDeposit, remainingBalance);
          return {
            pubkey: a.publicKey,
            owner: a.account.owner,
            totalDeposit,
            remainingBalance,
            isWithdrawn: a.account.isWithdrawn,
            urgencyLevel: a.account.urgencyLevel,
            filledAmount,
          };
        })
        .filter((v: VaultEntry) => v.remainingBalance > 0n);

      setVaults(entries);
      setSelectedVault((current) => {
        if (!current) return current;
        return (
          entries.find(
            (entry) => entry.pubkey.toBase58() === current.pubkey.toBase58()
          ) ?? null
        );
      });
    } catch (e) {
      console.error("Failed to fetch vaults:", e);
    } finally {
      setLoadingVaults(false);
    }
  }, [program]);

  useEffect(() => {
    if (program) fetchVaults();
  }, [program, fetchVaults]);

  useEffect(() => {
    if (program && view === "market") fetchVaults();
  }, [view]);

  useEffect(() => {
    if (bStatus === "done" && program) {
      fetchVaults();
      if (fillResult && bSig && selectedVault) {
        setPurchases((prev) => [
          {
            vaultKey: selectedVault.pubkey.toBase58(),
            filledAmount: fillResult.filledAmount,
            cost: fillResult.cost,
            txSig: bSig,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      }
    }
  }, [bStatus]);

  const handleDeposit = () => {
    if (!provider || !depositSol || !priceUsdc) return;
    deposit({
      depositLamports: BigInt(Math.round(parseFloat(depositSol) * 1e9)),
      pricePerToken: BigInt(Math.round(parseFloat(priceUsdc) * 1e6)),
      urgencyLevel: urgency,
    });
  };

  const handleBuy = () => {
    if (!provider || !selectedVault || !buyAmtSol || !maxPriceUsdc) return;
    submitBuy({
      slicerParentKey: selectedVault.pubkey,
      amountRequested: BigInt(Math.round(parseFloat(buyAmtSol) * 1e9)),
      maxPrice: BigInt(Math.round(parseFloat(maxPriceUsdc) * 1e6)),
    });
  };

  const myVault = getParentPda();
  const [myVaultEntry, setMyVaultEntry] = useState<VaultEntry | null>(null);

  useEffect(() => {
    if (!program || !myVault) return;
    const fetchMyVault = async () => {
      try {
        const acc = await (program.account as any).slicerParent.fetch(myVault);
        if (!acc.isWithdrawn) {
          setMyVaultEntry({
            pubkey: myVault,
            owner: acc.owner,
            totalDeposit: BigInt(acc.totalDeposit.toString()),
            remainingBalance: BigInt(acc.remainingBalance.toString()),
            isWithdrawn: acc.isWithdrawn,
            urgencyLevel: acc.urgencyLevel,
            filledAmount: getFilledAmount(
              BigInt(acc.totalDeposit.toString()),
              BigInt(acc.remainingBalance.toString())
            ),
          });
        } else {
          setMyVaultEntry(null);
        }
      } catch {
        setMyVaultEntry(null);
      }
    };
    fetchMyVault();
  }, [program, myVault, dStatus, withdrawing]);

  const depositBusy = ["sending", "waiting", "encrypting"].includes(dStatus);
  const buyBusy = [
    "sending",
    "waiting",
    "encrypting",
    "finalizing",
    "settling",
  ].includes(bStatus);
  const openLiquidity = vaults.reduce(
    (sum, vault) => sum + vault.remainingBalance,
    0n
  );
  const filledLiquidity = vaults.reduce(
    (sum, vault) => sum + vault.filledAmount,
    0n
  );
  const filledOrders = purchases.filter((p) => p.filledAmount > 0n).length;
  const walletState = wallet.publicKey ? shortKey(wallet.publicKey) : "—";
  const copyUsdcMint = () => navigator.clipboard.writeText(USDC_MINT.toBase58());

  return (
    <main className="darkpool-shell">
      <header className="top-nav">
        <div className="top-nav-inner">
          <button
            className="wordmark"
            onClick={() => setView("market")}
            aria-label="ArcSlicer home"
          >
            <span>ARC</span>
            <strong>SLICER</strong>
          </button>

          <div className="network-pill">
            <IconStatusDot />
            <span>Arcium MPC · Solana Devnet</span>
          </div>

          <div className="nav-actions">
            <div className="wallet-pill">
              <IconWallet />
              <WalletMultiButton />
            </div>
          </div>
        </div>
      </header>

      <section className="stats-strip" aria-label="Market status">
        <div className="stat-cell">
          <span>Live vaults</span>
          <strong>{fmtStatNumber(vaults.length)}</strong>
        </div>
        <div className="stat-cell">
          <span>Open SOL</span>
          <strong>{fmtStatSol(openLiquidity)}</strong>
        </div>
        <div className="stat-cell">
          <span>Filled SOL</span>
          <strong>{fmtStatSol(filledLiquidity)}</strong>
        </div>
        <div className="stat-cell">
          <span>Session fills</span>
          <strong>{fmtStatNumber(filledOrders)}</strong>
        </div>
        <div className="stat-cell">
          <span>Wallet</span>
          <strong>{walletState}</strong>
        </div>
      </section>

      <nav className="tab-strip">
        <div className="tab-list" aria-label="ArcSlicer views">
          {(
            [
              { key: "market", label: "Market" },
              { key: "sell", label: "Sell SOL" },
              { key: "manage", label: "My Vault" },
              { key: "history", label: "History" },
            ] as { key: View; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              className={`tab-button ${view === key ? "active" : ""}`}
              onClick={() => setView(key)}
            >
              <span>{label}</span>
              {key === "history" && purchases.length > 0 && (
                <span className="tab-count">{purchases.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="funds-tools">
          <button
            className="ghost-button"
            onClick={requestAirdrop}
            disabled={isDropping || !wallet.publicKey}
            title="Request devnet SOL and 1000 USDC"
          >
            <IconFaucet />
            <span>{isDropping ? "Funding" : "Devnet Funds"}</span>
          </button>
          <div className="mint-chip">
            <span>Devnet USDC</span>
            <code>{shortKey(USDC_MINT)}</code>
            <button onClick={copyUsdcMint} title="Copy mint">
              <IconCopy />
              <span>copy mint</span>
            </button>
          </div>
          {faucetLog && <span className="faucet-log">{faucetLog}</span>}
        </div>
      </nav>

      <div className="app-content">
        {view === "market" && (
          <section className="market-view">
            <div className="section-header">
              <div>
                <h2>Active Vaults</h2>
                <p>
                  Seller vaults are public price floors stay encrypted. Choose
                  a vault and submit your max USDC price.
                </p>
              </div>
              <button
                className="refresh-btn"
                onClick={fetchVaults}
                disabled={loadingVaults}
              >
                <IconRefresh spinning={loadingVaults} />
                <span>{loadingVaults ? "Loading" : "Refresh"}</span>
              </button>
            </div>

            {!wallet.publicKey && (
              <div className="empty-state">
                <IconVaultEmpty />
                <strong>Connect wallet to view vaults</strong>
                <span>Market depth loads after wallet connection.</span>
              </div>
            )}

            {wallet.publicKey && loadingVaults && vaults.length === 0 && (
              <div className="vault-rows" aria-label="Loading vaults">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="vault-row skeleton-row" />
                ))}
              </div>
            )}

            {wallet.publicKey && !loadingVaults && vaults.length === 0 && (
              <div className="empty-state">
                <IconVaultEmpty />
                <strong>No active vaults</strong>
                <button className="empty-link" onClick={() => setView("sell")}>
                  <span>Create a vault in Sell SOL</span>
                  <IconArrow />
                </button>
              </div>
            )}

            {vaults.length > 0 && (
              <div className="vault-rows">
                {vaults.map((vault) => {
                  const isOwn =
                    wallet.publicKey?.toBase58() === vault.owner.toBase58();
                  const isActive =
                    selectedVault?.pubkey.toBase58() === vault.pubkey.toBase58();
                  const fillPct = getFillPct(
                    vault.totalDeposit,
                    vault.remainingBalance
                  );
                  return (
                    <article
                      key={vault.pubkey.toBase58()}
                      className={`vault-row ${isOwn ? "own-vault" : ""} ${
                        isActive ? "selected" : ""
                      }`}
                      onClick={() =>
                        !isOwn && setSelectedVault(isActive ? null : vault)
                      }
                    >
                      <div className="vault-row-main">
                        <span>{isOwn ? "Your vault" : shortKey(vault.pubkey)}</span>
                        <strong>{fmtSol(vault.remainingBalance)}</strong>
                      </div>

                      <div className="vault-row-status">
                        <span className="live-badge">
                          <IconStatusDot />
                          Live
                        </span>
                        <code>{fillPct}% filled</code>
                      </div>

                      <div className="vault-row-meta">
                        <span>Total</span>
                        <strong>{fmtSol(vault.totalDeposit)}</strong>
                      </div>

                      <div
                        className="vault-fill"
                        style={
                          { "--fill-pct": `${fillPct}%` } as React.CSSProperties
                        }
                      >
                        <span />
                      </div>

                      <div className="vault-row-actions">
                        {!isOwn ? (
                          <>
                            <input
                              className="row-price-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={isActive ? maxPriceUsdc : ""}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={() => setSelectedVault(vault)}
                              onChange={(e) => {
                                setSelectedVault(vault);
                                setMaxPriceUsdc(e.target.value);
                              }}
                              placeholder="Max USDC"
                            />
                            <button
                              className="ghost-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVault(vault);
                              }}
                            >
                              Submit Bid
                            </button>
                          </>
                        ) : (
                          <button
                            className="ghost-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setView("manage");
                            }}
                          >
                            Manage
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {selectedVault && (
              <div className="buy-panel">
                <div className="panel-title-row">
                  <div>
                    <span>Private bid</span>
                    <h3>{shortKey(selectedVault.pubkey)}</h3>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setSelectedVault(null)}
                    aria-label="Close buy panel"
                  >
                    <IconClose />
                  </button>
                </div>
                <div className="panel-note">
                  <IconLock />
                  <span>Encrypted price check through Arcium before settlement.</span>
                </div>
                <div className="available-info">
                  <span>Available</span>
                  <strong>{fmtSol(selectedVault.remainingBalance)}</strong>
                </div>
                <div className="field-stack">
                  <label className="control-field">
                    <span>SOL amount to buy</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={buyAmtSol}
                      onChange={(e) => setBuyAmtSol(e.target.value)}
                      placeholder={`up to ${(
                        Number(selectedVault.remainingBalance) / 1e9
                      ).toFixed(3)}`}
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
                <button
                  className="action-button buyer-action"
                  onClick={handleBuy}
                  disabled={
                    !wallet.publicKey || !buyAmtSol || !maxPriceUsdc || buyBusy
                  }
                >
                  {buyBusy ? "Processing" : "Encrypt and Submit Order"}
                </button>
                {bStatus !== "idle" && (
                  <StepTracker status={bStatus} error={bErr} />
                )}
                {fillResult && (
                  <div className="fill-result">
                    <div
                      className={`fill-result-header ${
                        fillResult.filledAmount > 0n ? "filled" : "no-fill"
                      }`}
                    >
                      {fillResult.filledAmount > 0n ? (
                        <>
                          <IconCheck /> Order filled
                        </>
                      ) : (
                        <>No fill. Your max price was below the seller floor.</>
                      )}
                    </div>
                    {fillResult.filledAmount > 0n && (
                      <div className="fill-metrics">
                        <div>
                          <small>You received</small>
                          <strong>{fmtSol(fillResult.filledAmount)}</strong>
                        </div>
                        <div>
                          <small>Cost</small>
                          <strong>{fmtCost(fillResult.cost)}</strong>
                        </div>
                        <div>
                          <small>Effective price</small>
                          <strong>
                            {fmtEffectivePrice(
                              fillResult.cost,
                              fillResult.filledAmount
                            )}
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

        {view === "sell" && (
          <section className="sell-view">
            <div className="section-header">
              <div>
                <h2>Create Vault</h2>
                <p>
                  Deposit SOL and set a hidden floor. Buyers see size and fill
                  status, not your price.
                </p>
              </div>
            </div>
            <div className="trade-panel seller-panel">
              <div className="field-stack">
                <label className="control-field">
                  <span>SOL to deposit</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
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
                    onChange={(e) =>
                      setUrgency(Number(e.target.value) as 1 | 2 | 3)
                    }
                  >
                    <option value={1}>Stealth: slower, quieter</option>
                    <option value={2}>Standard: balanced</option>
                    <option value={3}>Aggressive: fastest fill</option>
                  </select>
                </label>
              </div>
              <button
                className="action-button seller-action"
                onClick={handleDeposit}
                disabled={
                  !wallet.publicKey || !depositSol || !priceUsdc || depositBusy
                }
              >
                {depositBusy ? "Processing" : "Encrypt and Deposit SOL"}
              </button>
              {dStatus !== "idle" && (
                <StepTracker status={dStatus} error={dErr} />
              )}
              {dStatus === "done" && myVault && (
                <div className="vault-created">
                  <strong>
                    <IconCheck /> Vault created
                  </strong>
                  <p>
                    Visible to buyers in Market. Track fills and withdraw in My
                    Vault.
                  </p>
                  <div className="vault-address-card">
                    <span>Vault address</span>
                    <code
                      onClick={() =>
                        navigator.clipboard.writeText(myVault.toBase58())
                      }
                    >
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

        {view === "manage" && (
          <section className="manage-view">
            <div className="section-header">
              <div>
                <h2>My Vault</h2>
                <p>Track fill status and withdraw unsold SOL.</p>
              </div>
            </div>
            {!wallet.publicKey && (
              <div className="empty-state">
                <IconVaultEmpty />
                <strong>Connect wallet</strong>
                <span>Your seller vault appears here.</span>
              </div>
            )}
            {wallet.publicKey && !myVaultEntry && (
              <div className="empty-state">
                <IconVaultEmpty />
                <strong>No active vault</strong>
                <button className="empty-link" onClick={() => setView("sell")}>
                  <span>Create a vault in Sell SOL</span>
                  <IconArrow />
                </button>
              </div>
            )}
            {myVaultEntry &&
              (() => {
                const fillPct = getFillPct(
                  myVaultEntry.totalDeposit,
                  myVaultEntry.remainingBalance
                );
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
                    <div
                      className="vault-fill manage-fill"
                      style={
                        { "--fill-pct": `${fillPct}%` } as React.CSSProperties
                      }
                    >
                      <span />
                    </div>
                    <div className="panel-note">
                      <IconLock /> Your price floor is encrypted under the Arcium
                      MXE key.
                    </div>
                    <button
                      className="action-button withdraw-action"
                      disabled={
                        myVaultEntry.remainingBalance === 0n || withdrawing
                      }
                      onClick={async () => {
                        setWithdrawing(true);
                        try {
                          await withdraw();
                        } finally {
                          setWithdrawing(false);
                        }
                      }}
                    >
                      {myVaultEntry.remainingBalance === 0n
                        ? "Nothing to Withdraw"
                        : withdrawing
                        ? "Withdrawing"
                        : `Withdraw ${fmtSol(myVaultEntry.remainingBalance)}`}
                    </button>
                  </div>
                );
              })()}
          </section>
        )}

        {view === "history" && (
          <section className="history-view">
            <div className="section-header">
              <div>
                <h2>Purchase History</h2>
                <p>Orders filled in this browser session.</p>
              </div>
            </div>
            {purchases.length === 0 && (
              <div className="empty-state">
                <IconVaultEmpty />
                <strong>No purchases yet</strong>
                <span>Filled orders will appear here.</span>
              </div>
            )}
            {purchases.length > 0 && (
              <div className="history-list">
                {purchases.map((p, i) => (
                  <div key={i} className="history-row">
                    <div className="history-row-top">
                      <span className="history-vault">
                        Vault {shortKey(p.vaultKey)}
                      </span>
                      <span className="history-time">
                        {new Date(p.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {p.filledAmount > 0n ? (
                      <div className="fill-metrics history-metrics">
                        <div>
                          <small>Received</small>
                          <strong>{fmtSol(p.filledAmount)}</strong>
                        </div>
                        <div>
                          <small>Paid</small>
                          <strong>{fmtCost(p.cost)}</strong>
                        </div>
                        <div>
                          <small>Price</small>
                          <strong>
                            {fmtEffectivePrice(p.cost, p.filledAmount)}
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <p className="no-fill-note">No fill. Price did not cross.</p>
                    )}
                    <TxLink signature={p.txSig} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="app-footer">
        <span>ArcSlicer · Built on Arcium · Solana Devnet</span>
        <div>
          <a href="https://docs.arcium.com/" target="_blank" rel="noreferrer">
            Docs
          </a>
          <a
            href="https://github.com/altraa92/arcslicer_2"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a href="https://discord.com/" target="_blank" rel="noreferrer">
            Discord
          </a>
        </div>
      </footer>
    </main>
  );
}

function StepTracker({
  status,
  error,
}: {
  status: string;
  error?: string | null;
}) {
  const steps = [
    { key: "encrypting", label: "Encrypt locally" },
    { key: "sending", label: "Send to Solana" },
    { key: "waiting", label: "Checking match" },
    { key: "finalizing", label: "Finalizing fill" },
    { key: "settling", label: "Settling tokens" },
    { key: "done", label: "Complete" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === status);
  return (
    <div className="step-tracker">
      {steps.map((step, i) => {
        const isDone = status === "done" || i < currentIdx;
        const isActive = status !== "done" && i === currentIdx;
        return (
          <div
            key={step.key}
            className={`step-item ${
              isDone ? "done" : isActive ? "active" : "pending"
            }`}
          >
            <div className="step-dot">
              {isDone ? (
                <IconCheck />
              ) : isActive ? (
                <span className="dot-pulse" />
              ) : (
                <span>{i + 1}</span>
              )}
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
