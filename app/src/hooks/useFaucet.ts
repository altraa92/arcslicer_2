// src/hooks/useFaucet.ts
// ──────────────────────────────────────────────────────────────────
// Devnet faucet: uses the configured faucet key to send SOL, wSOL, and USDC
// to the connected wallet in one transaction.
// This hook has nothing to do with Arcium - pure Solana SPL.
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
  createTransferInstruction,
  createSyncNativeInstruction,
  getAccount,
  getMint,
  NATIVE_MINT,
} from "@solana/spl-token";
import { USDC_MINT } from "../config/constants";

const GAS_LAMPORTS = 0.2 * LAMPORTS_PER_SOL;
const WSOL_LAMPORTS = 0.5 * LAMPORTS_PER_SOL;
const USDC_UNITS = 500n;

export const useFaucet = () => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [isDropping, setIsDropping] = useState(false);
  const [faucetLog, setFaucetLog] = useState<string>("");

  const requestAirdrop = async () => {
    if (!publicKey) return setFaucetLog("Connect wallet first.");
    setIsDropping(true);
    setFaucetLog("Preparing devnet liquidity...");

    try {
      const secretKeyString = import.meta.env.VITE_FAUCET_SECRET_KEY;
      if (!secretKeyString) throw new Error("Faucet secret key missing in .env");

      const secretKeyArray = Uint8Array.from(JSON.parse(secretKeyString));
      const funderKeypair = Keypair.fromSecretKey(secretKeyArray);

      setFaucetLog("Packaging SOL, wSOL, and USDC...");
      const tx = new Transaction();

      tx.add(
        SystemProgram.transfer({
          fromPubkey: funderKeypair.publicKey,
          toPubkey: publicKey,
          lamports: GAS_LAMPORTS,
        })
      );

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

      const usdcMint = await getMint(connection, USDC_MINT);
      const usdcAmount = USDC_UNITS * 10n ** BigInt(usdcMint.decimals);

      if (usdcMint.mintAuthority?.equals(funderKeypair.publicKey)) {
        tx.add(
          createMintToInstruction(
            USDC_MINT,
            userUsdcAta,
            funderKeypair.publicKey,
            usdcAmount
          )
        );
      } else {
        const funderUsdcAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          funderKeypair.publicKey
        );
        const funderUsdcInfo = await connection.getAccountInfo(funderUsdcAta);

        if (!funderUsdcInfo) {
          throw new Error(
            "Faucet key is not this mint's authority and has no USDC token account to transfer from. Use a mint controlled by the faucet key or pre-fund its USDC ATA."
          );
        }

        const funderUsdcAccount = await getAccount(connection, funderUsdcAta);
        if (funderUsdcAccount.amount < usdcAmount) {
          throw new Error(
            "Faucet USDC token account is underfunded. Pre-fund it or use a mint controlled by the faucet key."
          );
        }

        tx.add(
          createTransferInstruction(
            funderUsdcAta,
            userUsdcAta,
            funderKeypair.publicKey,
            usdcAmount
          )
        );
      }

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
          toPubkey: userWsolAta,
          lamports: WSOL_LAMPORTS,
        })
      );
      tx.add(createSyncNativeInstruction(userWsolAta));

      setFaucetLog("Submitting faucet transaction...");

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [funderKeypair]
      );

      setFaucetLog(`Delivery complete. Signature: ${signature.slice(0, 8)}...`);
    } catch (error: any) {
      console.error(error);
      const logs =
        typeof error?.getLogs === "function"
          ? await error.getLogs(connection).catch(() => null)
          : error?.logs;

      if (logs) console.error("Faucet transaction logs:", logs);

      const ownerMismatch = Array.isArray(logs)
        && logs.some((line) => line.includes("owner does not match"));
      const fallbackMessage = ownerMismatch
        ? "Faucet key is not authorized for one of the token operations. Check mint authority or faucet token inventory."
        : error.message;

      setFaucetLog(`Faucet failed: ${fallbackMessage}`);
    } finally {
      setIsDropping(false);
    }
  };

  return { requestAirdrop, isDropping, faucetLog };
};
