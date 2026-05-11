// src/hooks/useFaucet.ts
// Sends 1000 devnet USDC to the connected wallet.
// SOL for gas: users get that themselves via "Get SOL" which hits Solana's native airdrop.

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createTransferInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { USDC_MINT } from "../config/constants";

const USDC_UNITS = 1000n; // 1000 USDC

export const useFaucet = () => {
  const { connection } = useConnection();
  const { publicKey }  = useWallet();
  const [isDropping,  setIsDropping]  = useState(false);
  const [isSolDrop,   setIsSolDrop]   = useState(false); // unused but kept for type compat
  const [faucetLog,   setFaucetLog]   = useState<string>("");

  // One button: 2 SOL airdrop + 1000 USDC mint
  const requestSolAirdrop = async () => {}; // kept for compatibility, not used

  const requestAirdrop = async () => {
    if (!publicKey) return setFaucetLog("Connect wallet first.");
    setIsDropping(true);
    setFaucetLog("Requesting SOL + minting 1000 USDC…");

    try {
      const secretKeyString = import.meta.env.VITE_FAUCET_SECRET_KEY;
      if (!secretKeyString) throw new Error("Faucet key missing in .env");

      const funderKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(secretKeyString))
      );

      // SOL airdrop first (non-fatal if rate limited)
      try {
        const solSig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(solSig, "confirmed");
      } catch {
        setFaucetLog("SOL airdrop rate limited — continuing with USDC…");
      }

      const tx = new Transaction();

      const userUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const usdcAtaInfo = await connection.getAccountInfo(userUsdcAta);
      if (!usdcAtaInfo) {
        tx.add(createAssociatedTokenAccountInstruction(
          funderKeypair.publicKey, userUsdcAta, publicKey, USDC_MINT
        ));
      }

      const usdcMint   = await getMint(connection, USDC_MINT);
      const usdcAmount = USDC_UNITS * 10n ** BigInt(usdcMint.decimals);

      if (usdcMint.mintAuthority?.equals(funderKeypair.publicKey)) {
        tx.add(createMintToInstruction(
          USDC_MINT, userUsdcAta, funderKeypair.publicKey, usdcAmount
        ));
      } else {
        const funderUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, funderKeypair.publicKey);
        const funderAcc     = await getAccount(connection, funderUsdcAta);
        if (funderAcc.amount < usdcAmount) throw new Error("Faucet USDC depleted.");
        tx.add(createTransferInstruction(
          funderUsdcAta, userUsdcAta, funderKeypair.publicKey, usdcAmount
        ));
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [funderKeypair]);
      setFaucetLog(`Done — 2 SOL + 1000 USDC sent. Add USDC to Phantom using the mint address above. Tx: ${sig.slice(0, 8)}…`);
    } catch (e: any) {
      setFaucetLog(`Failed: ${e.message}`);
    } finally {
      setIsDropping(false);
    }
  };

  return { requestAirdrop, requestSolAirdrop, isDropping, isSolDrop, faucetLog };
};