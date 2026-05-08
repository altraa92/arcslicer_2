// src/hooks/useFaucet.ts
// ──────────────────────────────────────────────────────────────────
// Devnet faucet: uses the God Key to airdrop SOL, wSOL, and USDC
// to the connected wallet in one transaction.
// This hook has nothing to do with Arcium — pure Solana SPL.
// ──────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";
import { USDC_MINT } from "../config/constants";

export const useFaucet = () => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [isDropping, setIsDropping] = useState(false);
  const [faucetLog, setFaucetLog] = useState<string>("");

  const requestAirdrop = async () => {
    if (!publicKey) return setFaucetLog("Connect wallet first.");
    setIsDropping(true);
    setFaucetLog("Bypassing public faucet. Booting God Key...");

    try {
      const secretKeyString = import.meta.env.VITE_FAUCET_SECRET_KEY;
      if (!secretKeyString) throw new Error("Faucet Secret Key missing in .env");

      const secretKeyArray = Uint8Array.from(JSON.parse(secretKeyString));
      const funderKeypair = Keypair.fromSecretKey(secretKeyArray);

      setFaucetLog("Packaging Gas, wSOL, and USDC...");
      const tx = new Transaction();

      // ── PART 1: 0.2 SOL gas ──────────────────────────────────
      tx.add(
        SystemProgram.transfer({
          fromPubkey: funderKeypair.publicKey,
          toPubkey:   publicKey,
          lamports:   0.2 * LAMPORTS_PER_SOL,
        })
      );

      // ── PART 2: 500 USDC ─────────────────────────────────────
      const userUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, publicKey);
      const usdcAtaInfo = await connection.getAccountInfo(userUsdcAta);

      if (!usdcAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            funderKeypair.publicKey,
            userUsdcAta,
            publicKey,
            USDC_MINT
          )
        );
      }

      tx.add(
        createMintToInstruction(
          USDC_MINT,
          userUsdcAta,
          funderKeypair.publicKey,
          500 * 1_000_000
        )
      );

      // ── PART 3: 0.5 wSOL ─────────────────────────────────────
      const userWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey);
      const wsolAtaInfo = await connection.getAccountInfo(userWsolAta);

      if (!wsolAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            funderKeypair.publicKey,
            userWsolAta,
            publicKey,
            NATIVE_MINT
          )
        );
      }

      tx.add(
        SystemProgram.transfer({
          fromPubkey: funderKeypair.publicKey,
          toPubkey:   userWsolAta,
          lamports:   0.5 * LAMPORTS_PER_SOL,
        })
      );
      tx.add(createSyncNativeInstruction(userWsolAta));

      // ── EXECUTE ───────────────────────────────────────────────
      setFaucetLog("Executing silent delivery...");

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [funderKeypair]
      );

      setFaucetLog(`✅ Delivery Complete! Signature: ${signature.slice(0, 8)}...`);
    } catch (error: any) {
      console.error(error);
      setFaucetLog(`❌ Faucet Failed: ${error.message}`);
    } finally {
      setIsDropping(false);
    }
  };

  return { requestAirdrop, isDropping, faucetLog };
};