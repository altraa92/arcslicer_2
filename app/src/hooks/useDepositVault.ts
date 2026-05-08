// app/src/hooks/useDepositVault.ts

import { useState, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getCompDefAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { useArciumCipher } from "./useArciumCipher";

export type DepositStatus =
  | "idle" | "encrypting" | "sending" | "waiting" | "done" | "error";

interface DepositParams {
  depositAmount:         bigint;
  pricePerToken:         bigint;
  urgencyLevel:          1 | 2 | 3;
  mint:                  PublicKey;
  targetMint:            PublicKey;
  depositorTokenAccount: PublicKey;
}

export function useDepositVault(
  program:  anchor.Program<any> | null,
  provider: anchor.AnchorProvider | null
) {
  const [status, setStatus] = useState<DepositStatus>("idle");
  const [txSig,  setTxSig]  = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  const { init: initCipher, ready, encryptU64Pair } =
    useArciumCipher(provider, program?.programId ?? null);

  const deposit = useCallback(
    async (params: DepositParams) => {
      if (!program || !provider) return;
      try {
        if (!ready) await initCipher();
        setStatus("encrypting");

        const enc = encryptU64Pair(params.depositAmount, params.pricePerToken);

        const arciumEnv = getArciumEnv();
        const computationOffset = new anchor.BN(
          Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString()
        );

        const [slicerParent] = PublicKey.findProgramAddressSync(
          [Buffer.from("slicer_parent"), provider.wallet.publicKey.toBuffer(), params.mint.toBuffer()],
          program.programId
        );
        const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), provider.wallet.publicKey.toBuffer(), params.mint.toBuffer()],
          program.programId
        );

        setStatus("sending");

        const sig = await program.methods
          .depositAndInitVault(
            computationOffset,
            enc.ciphertext0,                                    // number[] = [u8;32] ✓
            enc.ciphertext1,                                    // number[] = [u8;32] ✓
            enc.pubKey,                                         // number[] = [u8;32] ✓
            enc.nonce,                                          // BN = u128 ✓
            new anchor.BN(params.depositAmount.toString()),
            params.urgencyLevel
          )
          .accountsPartial({
            owner:                  provider.wallet.publicKey,
            slicerParent,
            mint:                   params.mint,
            targetMint:             params.targetMint,
            depositorTokenAccount:  params.depositorTokenAccount,
            vaultTokenAccount,
            mxeAccount:             getMXEAccAddress(program.programId),
            mempoolAccount:         getMempoolAccAddress(arciumEnv.arciumClusterOffset),
            executingPool:          getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
            computationAccount:     getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
            compDefAccount:         getCompDefAccAddress(program.programId, getCompDefAccOffset("init_vault_balance")),
            clusterAccount:         getClusterAccAddress(arciumEnv.arciumClusterOffset),
          })
          .rpc({ commitment: "confirmed" });

        setTxSig(sig);
        setStatus("waiting");

        await awaitComputationFinalization(provider, computationOffset, program.programId, "confirmed");
        setStatus("done");
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setStatus("error");
      }
    },
    [program, provider, ready, initCipher, encryptU64Pair]
  );

  return { deposit, status, txSig, error };
}