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

const USDC_UNITS = 1000n;

const friendlySolAirdropError = (e: any) => {
  const message = e?.message ?? String(e ?? "");
  if (/rate limit|429|too many|airdrop request failed/i.test(message)) {
    return "SOL faucet is rate-limited by devnet right now. Try SOL again later.";
  }
  if (/blockhash|timeout|timed out/i.test(message)) {
    return "SOL faucet took too long to respond. Try SOL again later.";
  }
  return "SOL was not sent. Try SOL again later.";
};

const friendlyFaucetError = (e: any) => {
  const message = e?.message ?? String(e ?? "");
  if (/rate limit|429/i.test(message)) {
    return "The RPC is rate-limited right now, so the faucet transaction did not finish. Please try again later.";
  }
  if (/missing.*key|VITE_FAUCET_SECRET_KEY/i.test(message)) {
    return "The faucet is not configured for this build.";
  }
  if (/depleted/i.test(message)) {
    return "The faucet is out of USDC for now.";
  }
  return message || "Faucet request failed. Please try again.";
};

export const useFaucet = () => {
  const { connection } = useConnection();
  const { publicKey }  = useWallet();
  const [isDropping,  setIsDropping]  = useState(false);
  const [isSolDrop,   setIsSolDrop]   = useState(false);
  const [faucetLog,   setFaucetLog]   = useState<string>("");

  const requestSolAirdrop = async () => {
    if (!publicKey) return setFaucetLog("Connect wallet first.");
    setIsSolDrop(true);
    setFaucetLog("Requesting devnet SOL...");

    try {
      const solSig = await connection.requestAirdrop(
        publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(solSig, "confirmed");
      setFaucetLog(`2 SOL sent. Tx: ${solSig.slice(0, 8)}...`);
    } catch (e: any) {
      setFaucetLog(friendlySolAirdropError(e));
    } finally {
      setIsSolDrop(false);
    }
  };

  const requestAirdrop = async () => {
    if (!publicKey) return setFaucetLog("Connect wallet first.");
    setIsDropping(true);
    setFaucetLog("Requesting SOL and 1000 USDC...");

    try {
      const secretKeyString = import.meta.env.VITE_FAUCET_SECRET_KEY;
      if (!secretKeyString) throw new Error("Faucet key missing in .env");

      const funderKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(secretKeyString))
      );

      let solSent = false;
      let solMessage = "";

      try {
        const solSig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(solSig, "confirmed");
        solSent = true;
      } catch (e: any) {
        solMessage = friendlySolAirdropError(e);
        setFaucetLog(`${solMessage} Sending USDC now...`);
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
      setFaucetLog(
        solSent
          ? `Done. 2 SOL and 1000 USDC sent. USDC tx: ${sig.slice(0, 8)}...`
          : `1000 USDC sent. ${solMessage} USDC tx: ${sig.slice(0, 8)}...`
      );
    } catch (e: any) {
      setFaucetLog(friendlyFaucetError(e));
    } finally {
      setIsDropping(false);
    }
  };

  return { requestAirdrop, requestSolAirdrop, isDropping, isSolDrop, faucetLog };
};
