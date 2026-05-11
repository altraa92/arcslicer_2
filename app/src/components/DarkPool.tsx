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

const IconMarket = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="1"
      y="8"
      width="3"
      height="5"
      rx="0.5"
      fill="currentColor"
      opacity="0.5"
    />
    <rect
      x="5.5"
      y="5"
      width="3"
      height="8"
      rx="0.5"
      fill="currentColor"
      opacity="0.7"
    />
    <rect x="10" y="2" width="3" height="11" rx="0.5" fill="currentColor" />
  </svg>
);
const IconSell = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M7 1v9M3.5 7L7 10.5 10.5 7"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 12h10"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);
const IconVault = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect
      x="1.5"
      y="2.5"
      width="11"
      height="9"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M7 5V3.5M7 10.5V9M5 7H3.5M10.5 7H9"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
const IconHistory = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M7 4v3.5l2 1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
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

const SLICER_PARENT_LEN =
  8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 1 + 1 + 32 + 32 + 16 + 1; // 244
const CHILD_SLICE_LEN = 8 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 8 + 1 + 1; // 108

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
    requestSolAirdrop,
    isDropping,
    isSolDrop,
    faucetLog,
  } = useFaucet();

  const fetchVaults = useCallback(async () => {
    if (!program) return;
    setLoadingVaults(true);
    try {
      const [rawParents, rawChildren] = await Promise.all([
        program.provider.connection.getProgramAccounts(program.programId, {
          filters: [{ dataSize: SLICER_PARENT_LEN }],
        }),
        program.provider.connection.getProgramAccounts(program.programId, {
          filters: [{ dataSize: CHILD_SLICE_LEN }],
        }),
      ]);

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

      const childAccounts = rawChildren.flatMap(({ pubkey, account }) => {
        try {
          const decoded = program.coder.accounts.decode(
            "childSlice",
            account.data
          );
          return [{ publicKey: pubkey, account: decoded }];
        } catch {
          return [];
        }
      });

      const fillMap = new Map<string, bigint>();
      for (const child of childAccounts) {
        if (!child.account.isFilled) continue;
        const parentKey = child.account.parent.toBase58();
        const filledAmount = BigInt(
          child.account.filledLamports?.toString() ?? "0"
        );
        fillMap.set(parentKey, (fillMap.get(parentKey) ?? 0n) + filledAmount);
      }

      const entries: VaultEntry[] = parentAccounts
        .filter((a: any) => !a.account.isWithdrawn)
        .map((a: any) => {
          const totalDeposit = BigInt(a.account.totalDeposit.toString());
          const remainingBalance = BigInt(
            a.account.remainingBalance.toString()
          );
          const filledAmount =
            fillMap.get(a.publicKey.toBase58()) ??
            totalDeposit - remainingBalance;
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
            filledAmount:
              BigInt(acc.totalDeposit.toString()) -
              BigInt(acc.remainingBalance.toString()),
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
  const walletState = wallet.publicKey ? shortKey(wallet.publicKey) : "Offline";

  return (
    <main className="darkpool-shell">
      <header className="command-header">
        <div className="brand-lockup">
          <span className="eyebrow">Arcium MPC / Solana Devnet</span>
          <h1>
            Arc<span>Slicer</span>
          </h1>
          <p>
            Private SOL/USDC liquidity. Price limits stay encrypted while fills
            settle on Solana.
          </p>
        </div>
        <div className="header-console">
          <div className="wallet-frame">
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <section className="desk-stats" aria-label="Market status">
        <div className="desk-stat">
          <span>Live vaults</span>
          <strong>{vaults.length}</strong>
        </div>
        <div className="desk-stat">
          <span>Open SOL</span>
          <strong>{fmtSol(openLiquidity)}</strong>
        </div>
        <div className="desk-stat">
          <span>Filled SOL</span>
          <strong>{fmtSol(filledLiquidity)}</strong>
        </div>
        <div className="desk-stat">
          <span>Session fills</span>
          <strong>{filledOrders}</strong>
        </div>
        <div className="desk-stat">
          <span>Wallet</span>
          <strong>{walletState}</strong>
        </div>
      </section>

      <nav className="pool-nav">
        {(
          [
            { key: "market", label: "Market", icon: <IconMarket /> },
            { key: "sell", label: "Sell SOL", icon: <IconSell /> },
            { key: "manage", label: "My Vault", icon: <IconVault /> },
            { key: "history", label: "History", icon: <IconHistory /> },
          ] as { key: View; label: string; icon: React.ReactNode }[]
        ).map(({ key, label, icon }) => (
          <button
            key={key}
            className={`nav-tab ${view === key ? "active" : ""}`}
            onClick={() => setView(key)}
          >
            {icon}
            <span>{label}</span>
            {key === "history" && purchases.length > 0 && (
              <span className="nav-badge">{purchases.length}</span>
            )}
          </button>
        ))}
        <button
          className="nav-tab faucet-tab"
          onClick={requestAirdrop}
          disabled={isDropping || !wallet.publicKey}
          title="2 SOL airdrop + 1000 USDC"
        >
          <IconFaucet />
          <span>{isDropping ? "Funding..." : "Devnet Funds"}</span>
        </button>
        {faucetLog && <span className="faucet-log">{faucetLog}</span>}
        <div
          className="token-pill"
          title="Add this to Phantom under Devnet to see your USDC balance"
        >
          <span className="token-pill-label">Devnet USDC</span>
          <code
            className="token-pill-addr"
            onClick={() => navigator.clipboard.writeText(USDC_MINT.toBase58())}
            title="Click to copy"
          >
            {shortKey(USDC_MINT)}
          </code>
          <span className="token-pill-hint">copy mint</span>
        </div>
      </nav>

      {view === "market" && (
        <section className={`market-view ${selectedVault ? "has-selection" : ""}`}>
          <div className="market-header">
            <div>
              <h2>Active Vaults</h2>
              <p className="market-sub">
                Seller vaults are public, price floors stay private. Choose a
                vault and submit your max USDC price.
              </p>
            </div>
            <button
              className="refresh-btn"
              onClick={fetchVaults}
              disabled={loadingVaults}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  style={{
                    animation: loadingVaults
                      ? "spin 1s linear infinite"
                      : "none",
                  }}
                >
                  <path
                    d="M11 6.5A4.5 4.5 0 112 6.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M11 3v3.5H7.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {loadingVaults ? "Loading..." : "Refresh"}
              </span>
            </button>
          </div>

          {!wallet.publicKey && (
            <div className="connect-prompt">
              Connect your wallet to view and trade.
            </div>
          )}
          {wallet.publicKey && !loadingVaults && vaults.length === 0 && (
            <div className="empty-state">
              No active vaults. Go to <strong>Sell SOL</strong> to create the
              first one.
            </div>
          )}

          <div className="vault-grid">
            {vaults.map((vault) => {
              const isOwn =
                wallet.publicKey?.toBase58() === vault.owner.toBase58();
              const isActive =
                selectedVault?.pubkey.toBase58() === vault.pubkey.toBase58();
              const fillPct =
                vault.totalDeposit > 0n
                  ? Math.round(
                      Number((vault.filledAmount * 100n) / vault.totalDeposit)
                    )
                  : 0;
              return (
                <article
                  key={vault.pubkey.toBase58()}
                  className={`vault-card ${isOwn ? "own-vault" : ""} ${
                    isActive ? "selected" : ""
                  }`}
                  onClick={() =>
                    !isOwn && setSelectedVault(isActive ? null : vault)
                  }
                >
                  <div className="vault-card-top">
                    <span className="vault-label">
                      {isOwn ? "Your vault" : `Vault ${shortKey(vault.pubkey)}`}
                    </span>
                    <span className={`urgency-badge u${vault.urgencyLevel}`}>
                      {vault.urgencyLevel === 1
                        ? "Stealth"
                        : vault.urgencyLevel === 2
                        ? "Standard"
                        : "Aggressive"}
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
                      <div
                        className="fill-bar-inner"
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                    <span>{fillPct}% filled</span>
                  </div>
                  <div className="vault-card-footer">
                    <code>{shortKey(vault.pubkey)}</code>
                    {!isOwn && (
                      <span className="select-hint">
                        {isActive ? (
                          <>
                            <IconCheck /> Selected
                          </>
                        ) : (
                          <>
                            Select <IconArrow />
                          </>
                        )}
                      </span>
                    )}
                    {isOwn && (
                      <span className="own-hint">Manage in My Vault</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {selectedVault && (
            <div className="buy-panel">
              <div className="buy-panel-header">
                <h3>Buy from {shortKey(selectedVault.pubkey)}</h3>
                <button
                  className="close-btn"
                  onClick={() => setSelectedVault(null)}
                  aria-label="Close buy panel"
                >
                  <IconClose />
                </button>
              </div>
              <div className="how-it-works">
                <IconLock />
                <span>
                  Encrypted price check through Arcium before settlement.
                </span>
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
                  <small className="field-hint">
                    <IconLock /> Encrypted before leaving your browser.
                  </small>
                </label>
              </div>
              <button
                className="action-button buyer-action"
                onClick={handleBuy}
                disabled={
                  !wallet.publicKey || !buyAmtSol || !maxPriceUsdc || buyBusy
                }
              >
                {buyBusy ? "Processing..." : "Encrypt & submit order"}
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
                      <>No fill. Your max price was below the seller's floor.</>
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
          <div className="view-header">
            <h2>Create a private vault</h2>
            <p>
              Deposit SOL and set a hidden floor. Buyers see size and fill
              status, not your price.
            </p>
          </div>
          <div className="explainer-steps">
            {[
              {
                n: "1",
                title: "Deposit SOL + set a hidden floor price",
                body: "Your minimum price is encrypted before leaving your browser.",
              },
              {
                n: "2",
                title: "Buyers see your vault size, not your price",
                body: "They submit their own encrypted max price.",
              },
              {
                n: "3",
                title: "The match runs privately",
                body: "If the buyer's max price meets your floor, the order fills.",
              },
              {
                n: "4",
                title: "Withdraw unsold SOL anytime",
                body: "Track fill progress and withdraw remainder in My Vault.",
              },
            ].map((s) => (
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
                <small className="field-hint">
                  <IconLock /> Encrypted before sending.
                </small>
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
              {depositBusy ? "Processing..." : "Encrypt & deposit SOL"}
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
                  Visible to buyers in the Market tab. Track fills and withdraw
                  in My Vault.
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
          <div className="view-header">
            <h2>My Vault</h2>
            <p>Track fill status and withdraw unsold SOL.</p>
          </div>
          {!wallet.publicKey && (
            <div className="connect-prompt">Connect your wallet.</div>
          )}
          {wallet.publicKey && !myVaultEntry && (
            <div className="empty-state">
              No active vault. Go to <strong>Sell SOL</strong> to create one.
            </div>
          )}
          {myVaultEntry &&
            (() => {
              const fillPct =
                myVaultEntry.totalDeposit > 0n
                  ? Math.round(
                      Number(
                        ((myVaultEntry.totalDeposit -
                          myVaultEntry.remainingBalance) *
                          100n) /
                          myVaultEntry.totalDeposit
                      )
                    )
                  : 0;
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
                    className="fill-bar-wrap large"
                    style={{ marginTop: "1rem" }}
                  >
                    <div className="fill-bar">
                      <div
                        className="fill-bar-inner"
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="manage-note">
                    <IconLock /> Your price floor is encrypted on-chain under
                    the Arcium MXE key. Buyers and validators cannot read it.
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
                      ? "Nothing to withdraw"
                      : withdrawing
                      ? "Withdrawing..."
                      : `Withdraw ${fmtSol(
                          myVaultEntry.remainingBalance
                        )} to SOL`}
                  </button>
                </div>
              );
            })()}
        </section>
      )}

      {view === "history" && (
        <section className="manage-view">
          <div className="view-header">
            <h2>Purchase History</h2>
            <p>Orders filled in this browser session.</p>
          </div>
          {purchases.length === 0 && (
            <div className="empty-state">No purchases yet this session.</div>
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
                    <div
                      className="fill-metrics"
                      style={{ marginTop: "0.75rem" }}
                    >
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
