// app/src/hooks/useSecureBuy.ts

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

export type BuyStatus =
  | "idle" | "encrypting" | "sending" | "waiting" | "done" | "error";

export interface FillResult {
  filledAmount:    bigint;
  cost:            bigint;
  newVaultBalance: bigint;
}

interface BuyParams {
  slicerParentKey: PublicKey;
  amountRequested: bigint;
  maxPrice:        bigint;
}

export function useSecureBuy(
  program:  anchor.Program<any> | null,
  provider: anchor.AnchorProvider | null
) {
  const [status,     setStatus]     = useState<BuyStatus>("idle");
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [txSig,      setTxSig]      = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const { init: initCipher, ready, encryptU64Pair, decryptU64Pair } =
    useArciumCipher(provider, program?.programId ?? null);

  const submitBuy = useCallback(
    async (params: BuyParams) => {
      if (!program || !provider) return;
      try {
        if (!ready) await initCipher();
        setStatus("encrypting");

        const enc = encryptU64Pair(params.amountRequested, params.maxPrice);

        const arciumEnv = getArciumEnv();
        const computationOffset = new anchor.BN(
          Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString()
        );

        const [childSlice] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("child_slice"),
            params.slicerParentKey.toBuffer(),
            provider.wallet.publicKey.toBuffer(),
          ],
          program.programId
        );

        // Subscribe BEFORE sending so no callback is missed
        const resultPromise = new Promise<FillResult>((resolve, reject) => {
          const listener = program.addEventListener("matchResultEvent", (event: any) => {
            if (event.child.toBase58() === childSlice.toBase58()) {
              program.removeEventListener(listener);
              try {
                const nonce = Array.from(event.resultNonce) as number[];
                const [filledAmount, cost] = decryptU64Pair(
                  Array.from(event.filledAmountCiphertext) as number[],
                  Array.from(event.costCiphertext) as number[],
                  nonce
                );
                const [newVaultBalance] = decryptU64Pair(
                  Array.from(event.newBalanceCiphertext) as number[],
                  Array.from(event.newBalanceCiphertext) as number[],
                  nonce
                );
                resolve({ filledAmount, cost, newVaultBalance });
              } catch (e) { reject(e); }
            }
          });
          setTimeout(() => reject(new Error("MPC timeout after 120s")), 120_000);
        });

        setStatus("sending");

        const sig = await program.methods
          .secureBuyRequest(
            computationOffset,
            enc.ciphertext0,   // number[] = [u8;32] ✓
            enc.ciphertext1,   // number[] = [u8;32] ✓
            enc.pubKey,        // number[] = [u8;32] ✓
            enc.nonce,         // BN = u128 ✓
          )
          .accountsPartial({
            buyer:              provider.wallet.publicKey,
            slicerParent:       params.slicerParentKey,
            childSlice,
            mxeAccount:         getMXEAccAddress(program.programId),
            mempoolAccount:     getMempoolAccAddress(arciumEnv.arciumClusterOffset),
            executingPool:      getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
            computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
            compDefAccount:     getCompDefAccAddress(program.programId, getCompDefAccOffset("match_slice")),
            clusterAccount:     getClusterAccAddress(arciumEnv.arciumClusterOffset),
          })
          .rpc({ commitment: "confirmed" });

        setTxSig(sig);
        setStatus("waiting");

        await awaitComputationFinalization(provider, computationOffset, program.programId, "confirmed");

        const result = await resultPromise;
        setFillResult(result);
        setStatus("done");
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setStatus("error");
      }
    },
    [program, provider, ready, initCipher, encryptU64Pair, decryptU64Pair]
  );

  return { submitBuy, status, txSig, fillResult, error };
}