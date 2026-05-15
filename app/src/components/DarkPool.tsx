import React, { useState, useEffect, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useArciumCipher } from "../hooks/useArciumCipher";
import { usePrivatePool, type PoolSnapshot } from "../hooks/usePrivatePool";
import { useFaucet } from "../hooks/useFaucet";
import { PROGRAM_ID, USDC_MINT } from "../config/constants";
import idl from "../idl/arcslicer_2.json";

interface PurchaseRecord {
  filledAmount: bigint;
  cost: bigint;
  txSig: string;
  timestamp: number;
}

interface StoredPurchaseRecord {
  filledAmount: string;
  cost: string;
  txSig: string;
  timestamp: number;
}

interface SellerPositionRecord {
  slot: number;
  depositedLamports: string;
  fillBaselineLamports?: string;
  timestamp: number;
}

const fmtSol = (n: bigint) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 }) +
  " SOL";

const fmtStatNumber = (n: number) => (n === 0 ? "—" : n.toString());

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

const purchaseHistoryKey = (walletKey: string) =>
  `arcslicer:purchases:${walletKey}`;

const loadPurchaseHistory = (walletKey: string): PurchaseRecord[] => {
  try {
    const raw = window.localStorage.getItem(purchaseHistoryKey(walletKey));
    if (!raw) return [];
    const stored = JSON.parse(raw) as StoredPurchaseRecord[];
    return stored
      .filter((item) => item.txSig && item.filledAmount && item.cost)
      .map((item) => ({
        filledAmount: BigInt(item.filledAmount),
        cost: BigInt(item.cost),
        txSig: item.txSig,
        timestamp: item.timestamp,
      }));
  } catch {
    return [];
  }
};

const savePurchaseHistory = (
  walletKey: string,
  purchases: PurchaseRecord[]
) => {
  const stored: StoredPurchaseRecord[] = purchases.map((item) => ({
    filledAmount: item.filledAmount.toString(),
    cost: item.cost.toString(),
    txSig: item.txSig,
    timestamp: item.timestamp,
  }));
  window.localStorage.setItem(
    purchaseHistoryKey(walletKey),
    JSON.stringify(stored)
  );
};

const sellerPositionKey = (walletKey: string) =>
  `arcslicer:seller-position:${walletKey}`;

const loadSellerPosition = (walletKey: string): SellerPositionRecord | null => {
  try {
    const raw = window.localStorage.getItem(sellerPositionKey(walletKey));
    return raw ? (JSON.parse(raw) as SellerPositionRecord) : null;
  } catch {
    return null;
  }
};

const saveSellerPosition = (
  walletKey: string,
  position: SellerPositionRecord
) => {
  window.localStorage.setItem(sellerPositionKey(walletKey), JSON.stringify(position));
};

type View = "buy" | "sell" | "position" | "history";

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
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
  >
    <path
      d="M11.5 5.5A4.8 4.8 0 003.2 3.6L2 4.8"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 2v2.8h2.8"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 8.5a4.8 4.8 0 008.3 1.9L12 9.2"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 12V9.2H9.2"
      stroke="currentColor"
      strokeWidth="1.35"
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

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program, setProgram] = useState<anchor.Program<any> | null>(null);
  const [view, setView] = useState<View>("buy");
  const [depositSol, setDepositSol] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("");
  const [urgency, setUrgency] = useState<1 | 2 | 3>(2);
  const [buyAmtSol, setBuyAmtSol] = useState("");
  const [maxPriceUsdc, setMaxPriceUsdc] = useState("");
  const [poolSnapshot, setPoolSnapshot] = useState<PoolSnapshot | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);

  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [sellerPosition, setSellerPosition] =
    useState<SellerPositionRecord | null>(null);
  const [pendingDepositLamports, setPendingDepositLamports] =
    useState<bigint | null>(null);
  const walletKey = wallet.publicKey?.toBase58() ?? null;

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
    buy,
    withdrawCredit,
    cancelAndWithdraw,
    fetchPool,
    depositStatus: dStatus,
    buyStatus: bStatus,
    manageStatus,
    txSig,
    fillResult,
    lastBuyReceipt,
    depositError: dErr,
    buyError: bErr,
    manageError,
  } = usePrivatePool(program, provider, cipher);

  const {
    requestAirdrop,
    isDropping,
    faucetLog,
  } = useFaucet();
  const mySlot = poolSnapshot?.mySlot ?? null;

  const refreshPool = useCallback(async (options?: { silent?: boolean }) => {
    if (!program || !wallet.publicKey) return;
    const silent = options?.silent ?? false;
    if (!silent) setLoadingPool(true);
    try {
      setPoolSnapshot(await fetchPool());
    } catch (e) {
      console.error("Failed to fetch private pool:", e);
    } finally {
      if (!silent) setLoadingPool(false);
    }
  }, [program, wallet.publicKey, fetchPool]);

  useEffect(() => {
    refreshPool();
  }, [refreshPool, dStatus, bStatus, manageStatus]);

  useEffect(() => {
    if (!program || !wallet.publicKey) return;
    const isActive =
      poolSnapshot?.isMatching ||
      ["waiting", "finalizing", "settling"].includes(bStatus) ||
      ["waiting", "sending"].includes(dStatus) ||
      ["waiting", "sending"].includes(manageStatus);
    const timer = window.setInterval(
      () => refreshPool({ silent: true }),
      isActive ? 3000 : 7000
    );
    return () => window.clearInterval(timer);
  }, [
    program,
    wallet.publicKey,
    poolSnapshot?.isMatching,
    dStatus,
    bStatus,
    manageStatus,
    refreshPool,
  ]);

  useEffect(() => {
    if (!wallet.publicKey) return;
    if (dStatus !== "done" && bStatus !== "done" && manageStatus !== "done") {
      return;
    }
    const timer = window.setTimeout(() => {
      refreshPool({ silent: true });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [wallet.publicKey, dStatus, bStatus, manageStatus, refreshPool]);

  useEffect(() => {
    if (!walletKey) {
      setPurchases([]);
      setSellerPosition(null);
      return;
    }
    setPurchases(loadPurchaseHistory(walletKey));
    setSellerPosition(loadSellerPosition(walletKey));
  }, [walletKey]);

  useEffect(() => {
    if (!walletKey || !lastBuyReceipt) return;
    setPurchases((prev) => {
      if (prev.some((p) => p.txSig === lastBuyReceipt.txSig)) return prev;
      const next = [
        {
          filledAmount: lastBuyReceipt.filledAmount,
          cost: lastBuyReceipt.cost,
          txSig: lastBuyReceipt.txSig,
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 25);
      savePurchaseHistory(walletKey, next);
      return next;
    });
  }, [walletKey, lastBuyReceipt]);

  useEffect(() => {
    if (!walletKey || !poolSnapshot || mySlot === null) return;
    if (pendingDepositLamports === null) return;
    const next = {
      slot: mySlot,
      depositedLamports: pendingDepositLamports.toString(),
      fillBaselineLamports: poolSnapshot.myFilledLamports.toString(),
      timestamp: Date.now(),
    };
    saveSellerPosition(walletKey, next);
    setSellerPosition(next);
    setPendingDepositLamports(null);
  }, [walletKey, poolSnapshot, mySlot, pendingDepositLamports]);

  useEffect(() => {
    if (!walletKey || !poolSnapshot || mySlot !== null || !sellerPosition) {
      return;
    }
    window.localStorage.removeItem(sellerPositionKey(walletKey));
    setSellerPosition(null);
  }, [walletKey, poolSnapshot, mySlot, sellerPosition]);

  const handleDeposit = () => {
    if (!provider || !depositSol || !priceUsdc) return;
    const depositLamports = BigInt(Math.round(parseFloat(depositSol) * 1e9));
    setPendingDepositLamports(depositLamports);
    deposit({
      depositLamports,
      pricePerToken: BigInt(Math.round(parseFloat(priceUsdc) * 1e6)),
      urgencyLevel: urgency,
    });
  };

  const handleBuy = () => {
    if (!provider || !buyAmtSol || !maxPriceUsdc) return;
    buy({
      amountRequested: BigInt(Math.round(parseFloat(buyAmtSol) * 1e9)),
      maxPrice: BigInt(Math.round(parseFloat(maxPriceUsdc) * 1e6)),
    });
  };

  const depositBusy = ["sending", "waiting", "encrypting"].includes(dStatus);
  const buyBusy = [
    "sending",
    "waiting",
    "encrypting",
    "finalizing",
    "settling",
  ].includes(bStatus);
  const manageBusy = ["sending", "waiting", "encrypting"].includes(manageStatus);
  const filledOrders = purchases.filter((p) => p.filledAmount > 0n).length;
  const walletState = wallet.publicKey ? shortKey(wallet.publicKey) : "—";
  const myCredit = poolSnapshot?.myCredit ?? 0n;
  const myPendingCredit = poolSnapshot?.myPendingCredit ?? 0n;
  const poolSolVaultBalance = poolSnapshot?.poolSolVaultBalance ?? 0n;
  const copyUsdcMint = () => navigator.clipboard.writeText(USDC_MINT.toBase58());
  const occupiedSlots = poolSnapshot?.occupiedSlots ?? 0;
  const externalSlots = poolSnapshot?.externalSlots ?? 0;
  const activeSlots = poolSnapshot?.activeSlots ?? 0;
  const hasLiquidity = activeSlots > 0 && poolSolVaultBalance > 0n;
  const hasExternalLiquidity = externalSlots > 0 && poolSolVaultBalance > 0n;
  const canBuyFromPool = hasExternalLiquidity && mySlot === null;
  const poolSoldOut =
    Boolean(poolSnapshot?.isInitialized) &&
    occupiedSlots > 0 &&
    poolSolVaultBalance === 0n;
  const ownOnlyLiquidity =
    wallet.publicKey &&
    mySlot !== null &&
    activeSlots > 0 &&
    externalSlots === 0;
  const trackedDeposit =
    sellerPosition && sellerPosition.slot === mySlot
      ? BigInt(sellerPosition.depositedLamports)
      : null;
  const trackedFillBaseline =
    sellerPosition?.slot === mySlot && sellerPosition.fillBaselineLamports
      ? BigInt(sellerPosition.fillBaselineLamports)
      : null;
  const slotFillsSinceDeposit =
    trackedFillBaseline === null
      ? null
      : (poolSnapshot?.myFilledLamports ?? 0n) > trackedFillBaseline
      ? (poolSnapshot?.myFilledLamports ?? 0n) - trackedFillBaseline
      : 0n;
  const trackedRemaining =
    trackedDeposit !== null && slotFillsSinceDeposit !== null
      ? trackedDeposit > slotFillsSinceDeposit
        ? trackedDeposit - slotFillsSinceDeposit
        : 0n
      : null;
  const ownSlotRemaining =
    mySlot === null
      ? null
      : poolSoldOut
      ? 0n
      : trackedRemaining ??
        (occupiedSlots === 1 && hasLiquidity ? poolSolVaultBalance : null);
  const totalFilled = purchases.reduce((sum, p) => sum + p.filledAmount, 0n);
  const poolState = !wallet.publicKey
    ? "OFFLINE"
    : loadingPool
    ? "SYNCING"
    : !poolSnapshot
    ? "UNOPENED"
    : poolSnapshot.isMatching
    ? "MATCHING"
    : !hasLiquidity
    ? "EMPTY"
    : "READY";
  const buyButtonText = !wallet.publicKey
    ? "Connect Wallet First"
    : mySlot !== null
    ? "Use Another Wallet To Buy"
    : !hasExternalLiquidity
    ? "Waiting for External Liquidity"
    : buyBusy
    ? "Processing"
    : "Encrypt and Route Buy";
  const depositButtonText = !wallet.publicKey
    ? "Connect Wallet First"
    : depositBusy
    ? "Processing"
    : "Encrypt and Add Liquidity";
  const tabs: { key: View; label: string; count?: string }[] = [
    { key: "buy", label: "Buy" },
    { key: "sell", label: "Sell SOL" },
    { key: "position", label: "My Position", count: mySlot !== null ? `${mySlot + 1}` : undefined },
    { key: "history", label: "History", count: purchases.length ? purchases.length.toString() : undefined },
  ];

  return (
    <main className="darkpool-shell">
      <section className="private-hero">
        <div className="hero-topline">
          <div className="wordmark hero-wordmark" aria-label="ArcSlicer">
            <span>ARC</span>
            <strong>SLICER</strong>
          </div>

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

        <div className="hero-layout">
          <div className="hero-copy">
            <span className="hero-kicker">Private Solana Execution</span>
            <h1>
              <span>Buy and sell SOL</span>
              <span>without exposing</span>
              <span>price intent.</span>
            </h1>
            <p>
              Sellers add hidden liquidity. Buyers submit one encrypted max-price
              order. Arcium privately matches the pool, then Solana settles only
              the final executable result.
            </p>
          </div>

          <div className="hero-status-card">
            <span>Pool status</span>
            <strong>{poolState}</strong>
            <div className="status-pair">
              <code>{fmtStatNumber(activeSlots)}</code>
              <small>hidden seller slots</small>
            </div>
            <p>
              {hasLiquidity
                ? "Private liquidity is ready for encrypted buy orders."
                : poolSoldOut
                ? "The current private liquidity is fully sold. New seller liquidity will reopen buys."
                : "Add hidden sell liquidity before buyers can execute."}
            </p>
          </div>
        </div>

        <div className="action-bar">
          <nav className="tab-list" aria-label="ArcSlicer views">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`tab-button ${view === tab.key ? "active" : ""}`}
                onClick={() => setView(tab.key)}
              >
                <span>{tab.label}</span>
                {tab.count && <span className="tab-count">{tab.count}</span>}
              </button>
            ))}
          </nav>

          <div className="funds-tools hero-funds">
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
        </div>
      </section>

      <div className="app-content">
        {view === "buy" && (
          <section className="view-grid buy-view">
          <section className="trade-panel buy-panel primary-trade">
            <div className="panel-title-row">
              <div>
                <span>Buyer intent</span>
                <h3>Buy from the private pool</h3>
              </div>
              <button
                className="refresh-btn"
                onClick={() => refreshPool()}
                disabled={loadingPool}
              >
                <IconRefresh spinning={loadingPool} />
                <span>{loadingPool ? "Loading" : "Refresh"}</span>
              </button>
            </div>

            <div className="panel-note">
              <IconLock />
              <span>
                Enter the SOL you want and your max USDC price. The order is
                encrypted locally, routed inside Arcium, and returned as one
                blended execution.
              </span>
            </div>

            {!wallet.publicKey && (
              <div className="inline-alert">
                Connect a wallet to submit private buy orders.
              </div>
            )}

            {wallet.publicKey && mySlot !== null && (
              <div className="inline-alert warning">
                This wallet owns an active seller slot. Use another wallet to
                buy so you do not match against your own liquidity.
              </div>
            )}

            {wallet.publicKey && mySlot === null && !hasExternalLiquidity && (
              <div className="inline-alert warning">
                {poolSoldOut
                  ? "The private pool is sold out right now. The buy form will unlock as soon as a seller adds new SOL."
                  : "No external seller liquidity is active yet. Wait for another seller, or add liquidity from a different wallet."}
              </div>
            )}

            {wallet.publicKey && poolSnapshot?.isMatching && (
              <div className="inline-alert warning">
                The pool is matching another order. This page refreshes
                automatically, or you can refresh manually.
              </div>
            )}

            <div className="field-stack two-field-grid">
              <label className="control-field">
                <span>SOL amount to buy</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={buyAmtSol}
                  onChange={(e) => setBuyAmtSol(e.target.value)}
                  placeholder="e.g. 1"
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
                !wallet.publicKey ||
                !buyAmtSol ||
                !maxPriceUsdc ||
                buyBusy ||
                !canBuyFromPool ||
                Boolean(poolSnapshot?.isMatching)
              }
            >
              {buyButtonText}
            </button>

            {bStatus !== "idle" && <StepTracker status={bStatus} error={bErr} />}

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
                <div className="receipt-actions">
                  {txSig && <TxLink signature={txSig} />}
                  <button
                    className="ghost-button"
                    onClick={() => setView("history")}
                  >
                    View buyer history
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="side-panel pool-brief">
            <span>Private pool</span>
            <strong>{hasLiquidity ? "Ready for buyers" : "Waiting for sellers"}</strong>
            <div className="side-metric">
              <small>Hidden slots</small>
              <code>{fmtStatNumber(activeSlots)}</code>
            </div>
            <div className="side-metric">
              <small>External slots</small>
              <code>{fmtStatNumber(externalSlots)}</code>
            </div>
            <div className="side-metric">
              <small>Pool state</small>
              <code>{poolState}</code>
            </div>
            <div className="side-metric">
              <small>This session filled</small>
              <code>{totalFilled === 0n ? "—" : fmtSol(totalFilled)}</code>
            </div>
            <p>
              Buyers submit one encrypted intent. Arcium routes internally
              across hidden seller slots and returns one blended result. Empty
              pools are blocked before settlement.
            </p>
            {ownOnlyLiquidity && (
              <p>
                This wallet is the only active seller, so buy testing needs a
                second wallet.
              </p>
            )}
          </aside>
        </section>
        )}

        {view === "sell" && (
          <section className="view-grid sell-view">
          <section className="trade-panel seller-panel">
            <div className="panel-title-row">
              <div>
                <span>Seller liquidity</span>
                <h3>Add a hidden sell order</h3>
              </div>
            </div>

            <div className="panel-note">
              <IconLock />
              <span>
                Deposit SOL and set your minimum acceptable price. Buyers see
                pool availability, not your exact price floor.
              </span>
            </div>

            {mySlot !== null && (
              <div className="inline-alert success">
                You already have an active hidden slot. Manage it below before
                adding another order.
              </div>
            )}

            <div className="field-stack">
              <label className="control-field">
                <span>SOL to deposit</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={depositSol}
                  onChange={(e) => setDepositSol(e.target.value)}
                  placeholder="e.g. 2"
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
                !wallet.publicKey ||
                !depositSol ||
                !priceUsdc ||
                depositBusy ||
                mySlot !== null
              }
            >
              {mySlot !== null ? "Slot Already Active" : depositButtonText}
            </button>
            {dStatus !== "idle" && <StepTracker status={dStatus} error={dErr} />}
            {dStatus === "done" && (
              <div className="vault-created">
                <strong>
                  <IconCheck /> Hidden order added
                </strong>
                <p>
                  The order was queued into the private pool. The My Position
                  panel refreshes automatically, and you can also refresh it
                  manually.
                </p>
                <div className="vault-address-card">
                  <span>Pool address</span>
                  <code
                    onClick={() =>
                      poolSnapshot?.poolBook &&
                      navigator.clipboard.writeText(poolSnapshot.poolBook.toBase58())
                    }
                  >
                    {poolSnapshot
                      ? poolSnapshot.poolBook.toBase58()
                      : "Initializing"}
                  </code>
                  <small>Click to copy</small>
                </div>
                {txSig && <TxLink signature={txSig} />}
              </div>
            )}
          </section>

          <aside className="side-panel seller-brief">
            <span>Seller progress</span>
            <strong>
              {mySlot !== null
                ? poolSoldOut
                  ? `Slot #${mySlot + 1} sold`
                  : `Slot #${mySlot + 1} active`
                : "No slot yet"}
            </strong>
            <div className="progress-list">
              <div className={`progress-line ${mySlot !== null ? "done" : "active"}`}>
                <IconCheck />
                <span>Encrypt order locally</span>
              </div>
              <div className={`progress-line ${mySlot !== null ? "done" : ""}`}>
                <IconStatusDot />
                <span>Join private pool</span>
              </div>
              <div className={`progress-line ${myCredit > 0n ? "done" : "waiting"}`}>
                <IconStatusDot />
                <span>Earn USDC as buyers cross</span>
              </div>
              <div className={`progress-line ${poolSoldOut ? "done" : "waiting"}`}>
                <IconStatusDot />
                <span>Liquidity fully sold</span>
              </div>
            </div>
            <p>
              Remaining SOL and your floor price are encrypted. Your visible
              seller progress is slot status and withdrawable USDC credit.
            </p>
            {mySlot !== null && (
              <button className="ghost-button" onClick={() => setView("position")}>
                Open My Position
              </button>
            )}
          </aside>
        </section>
        )}

        {view === "position" && (
          <section className="view-grid position-view">
          <section className="manage-card position-card">
            <div className="panel-title-row">
              <div>
                <span>My position</span>
                <h3>Your hidden pool slot</h3>
              </div>
              <button
                className="refresh-btn"
                onClick={() => refreshPool()}
                disabled={loadingPool}
              >
                <IconRefresh spinning={loadingPool} />
                <span>{loadingPool ? "Loading" : "Refresh"}</span>
              </button>
            </div>

            {!wallet.publicKey && (
              <div className="empty-state compact-empty">
                <IconVaultEmpty />
                <strong>Connect wallet</strong>
                <span>Your encrypted sell slot appears here.</span>
              </div>
            )}

            {wallet.publicKey && mySlot === null && (
              <div className="empty-state compact-empty">
                <IconVaultEmpty />
                <strong>No active hidden slot</strong>
                <span>
                  Add sell liquidity above. If you just added it, press refresh
                  after Arcium finalizes.
                </span>
              </div>
            )}

            {wallet.publicKey && mySlot !== null && (
              <>
                <div className="manage-row">
                  <span>Private slot</span>
                  <strong>#{mySlot + 1}</strong>
                </div>
                {trackedDeposit !== null && (
                  <div className="manage-row">
                    <span>Initial deposit</span>
                    <strong>{fmtSol(trackedDeposit)}</strong>
                  </div>
                )}
                <div className="manage-row">
                  <span>SOL left</span>
                  <strong>
                    {ownSlotRemaining === null
                      ? "Encrypted"
                      : fmtSol(ownSlotRemaining)}
                  </strong>
                </div>
                <div className="manage-row">
                  <span>Settled USDC credit</span>
                  <strong>{myCredit === 0n ? "—" : fmtCost(myCredit)}</strong>
                </div>
                {myPendingCredit > 0n && (
                  <div className="manage-row warning-row">
                    <span>Pending settlement</span>
                    <strong>{fmtCost(myPendingCredit)}</strong>
                  </div>
                )}
                {poolSoldOut && (
                  <div className="inline-alert success">
                    This pool has no SOL left to buy. Withdraw settled USDC, or
                    add a fresh hidden sell order after this slot is cleared.
                  </div>
                )}
                {myPendingCredit > 0n && (
                  <div className="inline-alert warning">
                    The old slot credit is higher than the USDC currently held
                    by the pool. ArcSlicer will withdraw the settled USDC and
                    clear the stale remainder from this slot.
                  </div>
                )}
                {ownSlotRemaining === null && (
                  <div className="inline-alert">
                    Your exact per-slot SOL balance is still encrypted. New
                    deposits made from this browser are tracked locally, and
                    cancelling the slot reveals the exact remainder.
                  </div>
                )}
                <div className="panel-note">
                  <IconLock /> Your remaining SOL and floor price stay encrypted
                  in the pool book until you cancel or a trade settles.
                </div>
                <button
                  className="action-button withdraw-action"
                  disabled={myCredit === 0n || manageBusy}
                  onClick={() => withdrawCredit(mySlot)}
                >
                  {myCredit === 0n
                    ? "No USDC Credit"
                    : manageBusy
                    ? "Processing"
                    : `Withdraw ${fmtCost(myCredit)}`}
                </button>
                <button
                  className="ghost-button"
                  disabled={manageBusy || poolSoldOut}
                  onClick={() => cancelAndWithdraw(mySlot)}
                >
                  {poolSoldOut ? "SOL Fully Sold" : "Cancel order and withdraw SOL"}
                </button>
                {manageStatus !== "idle" && (
                  <StepTracker status={manageStatus} error={manageError} />
                )}
              </>
            )}
          </section>

          <aside className="side-panel position-progress">
            <span>Seller lifecycle</span>
            <strong>
              {mySlot !== null
                ? poolSoldOut
                  ? "Sold out"
                  : "Live in the pool"
                : "Start with a sell order"}
            </strong>
            <div className="progress-list">
              <div className={`progress-line ${mySlot !== null ? "done" : "waiting"}`}>
                <IconCheck />
                <span>Slot opened</span>
              </div>
              <div className={`progress-line ${poolSnapshot?.isMatching ? "active" : "waiting"}`}>
                <IconStatusDot />
                <span>Private matching</span>
              </div>
            <div className={`progress-line ${myCredit > 0n ? "done" : "waiting"}`}>
                <IconStatusDot />
                <span>USDC credit available</span>
              </div>
              <div className={`progress-line ${poolSoldOut ? "done" : "waiting"}`}>
                <IconStatusDot />
                <span>Pool sold out</span>
              </div>
            </div>
            <div className="side-metric">
              <small>Wallet</small>
              <code>{walletState}</code>
            </div>
            <div className="side-metric">
              <small>Withdrawable credit</small>
              <code>{myCredit === 0n ? "—" : fmtCost(myCredit)}</code>
            </div>
            <div className="side-metric">
              <small>SOL left</small>
              <code>
                {ownSlotRemaining === null ? "Encrypted" : fmtSol(ownSlotRemaining)}
              </code>
            </div>
            {myPendingCredit > 0n && (
              <div className="side-metric">
                <small>Pending credit</small>
                <code>{fmtCost(myPendingCredit)}</code>
              </div>
            )}
          </aside>
        </section>
        )}

        {view === "history" && (
          <section className="history-view">
            <section className="history-card">
            <div className="panel-title-row">
              <div>
                <span>Buyer history</span>
                <h3>Private fills</h3>
              </div>
              {purchases.length > 0 && walletKey && (
                <button
                  className="refresh-btn"
                  onClick={() => {
                    window.localStorage.removeItem(purchaseHistoryKey(walletKey));
                    setPurchases([]);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {purchases.length === 0 && (
              <div className="empty-state compact-empty">
                <IconVaultEmpty />
                <strong>No purchases yet</strong>
                <span>
                  Filled and no-fill buy attempts will appear here for this
                  wallet.
                </span>
              </div>
            )}
            {purchases.length > 0 && (
              <div className="history-list">
                {purchases.map((p, i) => (
                  <div key={i} className="history-row">
                    <div className="history-row-top">
                      <span className="history-vault">
                        Private pool fill
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
          <a
            href="https://discord.com/invite/arcium"
            target="_blank"
            rel="noreferrer"
          >
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
