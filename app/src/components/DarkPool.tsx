import { useState, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useDepositVault } from "../hooks/useDepositVault";
import { useSecureBuy } from "../hooks/useSecureBuy";
import { useFaucet } from "../hooks/useFaucet";
import idl from "../idl/arcslicer_2.json";

const fmt = (n: bigint, dec = 6) =>
  (Number(n) / 10 ** dec).toLocaleString(undefined, { maximumFractionDigits: 4 });

const LABEL: Record<string, string> = {
  idle: "Ready",
  encrypting: "Encrypting locally",
  sending: "Submitting to Solana",
  waiting: "MPC cluster computing",
  done: "Confirmed",
  error: "Error",
};

export default function DarkPool() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [provider, setProvider] = useState<anchor.AnchorProvider | null>(null);
  const [program, setProgram] = useState<anchor.Program<any> | null>(null);

  const [mintAddr, setMintAddr] = useState("");
  const [targetMint, setTargetMint] = useState("");
  const [depositorAta, setDepositorAta] = useState("");
  const [depositAmt, setDepositAmt] = useState("");
  const [priceAmt, setPriceAmt] = useState("");
  const [urgency, setUrgency] = useState<1 | 2 | 3>(2);

  const [parentKey, setParentKey] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [maxPriceAmt, setMaxPriceAmt] = useState("");

  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return;

    const prov = new anchor.AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    anchor.setProvider(prov);
    setProvider(prov);
    setProgram(new anchor.Program(idl as any, prov));
  }, [wallet.publicKey, wallet.signTransaction, connection]);

  const { deposit, status: dStatus, txSig: dSig, error: dErr } = useDepositVault(program, provider);
  const { submitBuy, status: bStatus, txSig: bSig, fillResult, error: bErr } = useSecureBuy(program, provider);
  const { requestAirdrop, isDropping, faucetLog } = useFaucet();

  const handleDeposit = () => {
    if (!provider || !depositAmt || !priceAmt || !mintAddr) return;

    deposit({
      depositAmount: BigInt(Math.round(parseFloat(depositAmt) * 1e6)),
      pricePerToken: BigInt(Math.round(parseFloat(priceAmt) * 1e6)),
      urgencyLevel: urgency,
      mint: new PublicKey(mintAddr),
      targetMint: new PublicKey(targetMint),
      depositorTokenAccount: new PublicKey(depositorAta),
    });
  };

  const handleBuy = () => {
    if (!provider || !parentKey || !buyAmt || !maxPriceAmt) return;

    submitBuy({
      slicerParentKey: new PublicKey(parentKey),
      amountRequested: BigInt(Math.round(parseFloat(buyAmt) * 1e6)),
      maxPrice: BigInt(Math.round(parseFloat(maxPriceAmt) * 1e6)),
    });
  };

  const depositBusy = dStatus === "sending" || dStatus === "waiting" || dStatus === "encrypting";
  const buyBusy = bStatus === "sending" || bStatus === "waiting" || bStatus === "encrypting";

  return (
    <main className="darkpool-shell">
      <div className="market-grid" aria-hidden="true" />
      <div className="orb orb-a" aria-hidden="true" />
      <div className="orb orb-b" aria-hidden="true" />

      <header className="command-header">
        <div className="brand-lockup">
          <span className="eyebrow">Arcium MPC desk</span>
          <h1>
            Arc<span>Slicer</span>
          </h1>
          <p>Private order flow for Solana whales and buyers. Inputs encrypt locally, matching executes inside Arcium.</p>
        </div>

        <div className="header-console">
          <div className="signal-card">
            <span>Execution mode</span>
            <strong>Dark pool</strong>
          </div>
          <div className="wallet-frame">
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <section className="liquidity-rail" aria-label="Devnet faucet status">
        <div>
          <span className="rail-kicker">Local test capital</span>
          <p>{faucetLog || "0.2 SOL, 500 USDC, and 0.5 wSOL available for devnet trials"}</p>
        </div>
        <button className="action-button rail-button" onClick={requestAirdrop} disabled={isDropping || !wallet.publicKey}>
          {isDropping ? "Funding wallet" : "Request devnet liquidity"}
        </button>
      </section>

      <section className="deal-board" aria-label="Dark pool actions">
        <article className="trade-panel seller-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">01</span>
              <h2>Seed private vault</h2>
            </div>
            <span className="tech-pill">Enc&lt;Shared&gt; to Enc&lt;Mxe&gt;</span>
          </div>

          <p className="panel-copy">
            Seller deposits SPL liquidity, then Arcium seals the vault state under the MXE so price and inventory can be matched without public exposure.
          </p>

          <div className="field-stack">
            <label className="control-field">
              <span>Token mint for sale</span>
              <input value={mintAddr} onChange={(e) => setMintAddr(e.target.value)} placeholder="So11111111111111111111111111111111111111112" />
            </label>

            <label className="control-field">
              <span>Settlement mint wanted</span>
              <input value={targetMint} onChange={(e) => setTargetMint(e.target.value)} placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" />
            </label>

            <label className="control-field">
              <span>Seller token account</span>
              <input value={depositorAta} onChange={(e) => setDepositorAta(e.target.value)} placeholder="Associated token account" />
            </label>

            <div className="split-fields">
              <label className="control-field">
                <span>Deposit amount</span>
                <input type="number" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="1000" />
              </label>

              <label className="control-field">
                <span>Limit price</span>
                <input type="number" value={priceAmt} onChange={(e) => setPriceAmt(e.target.value)} placeholder="0.50" />
              </label>
            </div>

            <label className="control-field">
              <span>Execution urgency</span>
              <select value={urgency} onChange={(e) => setUrgency(Number(e.target.value) as 1 | 2 | 3)}>
                <option value={1}>Stealth - slower, quieter execution</option>
                <option value={2}>Standard - balanced cadence</option>
                <option value={3}>Aggressive - faster fill attempts</option>
              </select>
            </label>
          </div>

          <button
            className="action-button seller-action"
            onClick={handleDeposit}
            disabled={!wallet.publicKey || !depositAmt || !priceAmt || !mintAddr || depositBusy}
          >
            Encrypt and deposit
          </button>

          {dStatus !== "idle" && <StatusLine status={dStatus} error={dErr} />}
          {dSig && <TxLink signature={dSig} />}
        </article>

        <article className="trade-panel buyer-panel">
          <div className="panel-topline">
            <div>
              <span className="panel-index">02</span>
              <h2>Route dark order</h2>
            </div>
            <span className="tech-pill amber">Enc&lt;Shared&gt; match</span>
          </div>

          <p className="panel-copy">
            Buyer submits encrypted amount and max price. The cluster computes fill and cost, then emits only buyer-decryptable ciphertext.
          </p>

          <div className="field-stack compact-stack">
            <label className="control-field">
              <span>SlicerParent PDA</span>
              <input value={parentKey} onChange={(e) => setParentKey(e.target.value)} placeholder="Private vault PDA" />
            </label>

            <div className="split-fields">
              <label className="control-field">
                <span>Amount requested</span>
                <input type="number" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} placeholder="100" />
              </label>

              <label className="control-field">
                <span>Max price</span>
                <input type="number" value={maxPriceAmt} onChange={(e) => setMaxPriceAmt(e.target.value)} placeholder="0.55" />
              </label>
            </div>
          </div>

          <button
            className="action-button buyer-action"
            onClick={handleBuy}
            disabled={!wallet.publicKey || !parentKey || !buyAmt || !maxPriceAmt || buyBusy}
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
                  <strong>{fmt(fillResult.filledAmount)}</strong>
                </div>
                <div>
                  <small>Cost</small>
                  <strong>{fmt(fillResult.cost)}</strong>
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

type StatusLineProps = {
  status: string;
  error?: string | null;
  tone?: "sand" | "brass";
};

function StatusLine({ status, error, tone = "sand" }: StatusLineProps) {
  const stateClass = status === "done" ? "is-done" : status === "error" ? "is-error" : `is-active ${tone}`;

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
      <a href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noreferrer">
        {signature.slice(0, 20)}...
      </a>
    </p>
  );
}
