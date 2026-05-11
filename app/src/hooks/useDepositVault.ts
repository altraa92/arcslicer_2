import { useState, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import {
  awaitComputationFinalization,
  getCompDefAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
} from "@arcium-hq/client";
import { type ArciumCipher } from "./useArciumCipher";
import { WSOL_MINT, USDC_MINT, randomBytes, compDefOffset } from "../config/constants";

const CLUSTER_OFFSET = 456;

const friendlyDepositError = (e: any) => {
  const message = e?.message ?? String(e ?? "");
  if (/user rejected|rejected/i.test(message)) {
    return "Transaction cancelled.";
  }
  if (/insufficient lamports|0x1/i.test(message)) {
    return "This wallet needs more devnet SOL for the deposit and fees.";
  }
  if (/already in use/i.test(message)) {
    return "This wallet already has a vault. Withdraw the current vault before creating another one.";
  }
  if (/blockhash|timeout|timed out/i.test(message)) {
    return "The network took too long to respond. Please try again.";
  }
  return message || "Deposit failed. Please try again.";
};

export type DepositStatus =
  | "idle" | "encrypting" | "sending" | "waiting" | "done" | "error";

interface DepositParams {
  depositLamports: bigint;
  pricePerToken:   bigint;
  urgencyLevel:    1 | 2 | 3;
}

export function useDepositVault(
  program:  anchor.Program<any> | null,
  provider: anchor.AnchorProvider | null,
  cipher:   ArciumCipher
) {
  const [status, setStatus] = useState<DepositStatus>("idle");
  const [txSig,  setTxSig]  = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  const deposit = useCallback(
    async (params: DepositParams) => {
      if (!program || !provider) return;
      setError(null);

      try {
        if (!cipher.ready) await cipher.init();
        setStatus("encrypting");

        const owner = provider.wallet.publicKey;

        const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, owner);

        const [slicerParent] = PublicKey.findProgramAddressSync(
          [Buffer.from("slicer_parent"), owner.toBuffer(), WSOL_MINT.toBuffer()],
          program.programId
        );

        const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), owner.toBuffer(), WSOL_MINT.toBuffer()],
          program.programId
        );

        const existingVault = await provider.connection.getAccountInfo(
          slicerParent
        );
        if (existingVault) {
          const existingParent = await (program.account as any).slicerParent.fetch(
            slicerParent
          );
          const remainingBalance = BigInt(
            existingParent.remainingBalance.toString()
          );

          if (!existingParent.isWithdrawn && remainingBalance > 0n) {
            throw new Error(
              `This seller wallet already has an active vault with ${(
                Number(remainingBalance) / 1e9
              ).toFixed(4)} SOL remaining. Withdraw it before creating a new one.`
            );
          }

          setStatus("sending");
          await program.methods
            .closeVault()
            .accountsPartial({
              owner,
              slicerParent,
              vaultTokenAccount,
            })
            .rpc({ commitment: "confirmed" });
          setStatus("encrypting");
        }

        const enc = cipher.encryptU64Pair(
          params.depositLamports,
          params.pricePerToken
        );

        const computationOffset = new anchor.BN(
          Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString()
        );

        setStatus("sending");

        const setupTx   = new Transaction();
        const wsolAtaInfo = await provider.connection.getAccountInfo(wsolAta);
        if (!wsolAtaInfo) {
          setupTx.add(createAssociatedTokenAccountInstruction(owner, wsolAta, owner, WSOL_MINT));
        }
        setupTx.add(
          SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsolAta, lamports: Number(params.depositLamports) }),
          createSyncNativeInstruction(wsolAta)
        );
        const { blockhash } = await provider.connection.getLatestBlockhash();
        setupTx.recentBlockhash = blockhash;
        setupTx.feePayer = owner;
        const signedSetup = await provider.wallet.signTransaction(setupTx);
        await provider.connection.sendRawTransaction(signedSetup.serialize(), { skipPreflight: false });

        const sig = await program.methods
          .depositAndInitVault(
            computationOffset,
            enc.ciphertext0,
            enc.ciphertext1,
            enc.pubKey,
            enc.nonce,
            new anchor.BN(params.depositLamports.toString()),
            params.urgencyLevel
          )
          .accountsPartial({
            owner,
            slicerParent,
            mint:                  WSOL_MINT,
            targetMint:            USDC_MINT,
            depositorTokenAccount: wsolAta,
            vaultTokenAccount,
            mxeAccount:            getMXEAccAddress(program.programId),
            mempoolAccount:        getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool:         getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount:    getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
            compDefAccount:        getCompDefAccAddress(program.programId, compDefOffset("init_vault_balance")),
            clusterAccount:        getClusterAccAddress(CLUSTER_OFFSET),
          })
          .rpc({ commitment: "confirmed" });

        setTxSig(sig);
        setStatus("waiting");

        await awaitComputationFinalization(provider, computationOffset, program.programId, "confirmed");
        setStatus("done");
      } catch (e: any) {
        setError(friendlyDepositError(e));
        setStatus("error");
      }
    },
    [program, provider, cipher]
  );

  const getParentPda = useCallback((): PublicKey | null => {
    if (!program || !provider) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("slicer_parent"), provider.wallet.publicKey.toBuffer(), WSOL_MINT.toBuffer()],
      program.programId
    );
    return pda;
  }, [program, provider]);

  const withdraw = useCallback(async () => {
    if (!program || !provider) return;
    const owner = provider.wallet.publicKey;
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, owner);

    const [slicerParent] = PublicKey.findProgramAddressSync(
      [Buffer.from("slicer_parent"), owner.toBuffer(), WSOL_MINT.toBuffer()],
      program.programId
    );
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.toBuffer(), WSOL_MINT.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .withdrawRemainder()
        .accountsPartial({
          owner,
          slicerParent,
          vaultTokenAccount,
          ownerTokenAccount: wsolAta,
        })
        .rpc({ commitment: "confirmed" });

      const closeTx = new anchor.web3.Transaction().add(
        createCloseAccountInstruction(wsolAta, owner, owner)
      );
      const { blockhash } = await provider.connection.getLatestBlockhash();
      closeTx.recentBlockhash = blockhash;
      closeTx.feePayer = owner;
      const signed = await provider.wallet.signTransaction(closeTx);
      await provider.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    } catch (e: any) {
      console.error("Withdraw failed:", e?.message);
      throw e;
    }
  }, [program, provider]);

  return { deposit, withdraw, status, txSig, error, getParentPda };
}
