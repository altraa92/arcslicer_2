/**
 * useSecureBuy.ts
 */

import { useState, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
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
import { randomBytes, compDefOffset } from "../config/constants";

const CLUSTER_OFFSET = 456;

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
  provider: anchor.AnchorProvider | null,
  cipher:   ArciumCipher
) {
  const [status,     setStatus]     = useState<BuyStatus>("idle");
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [txSig,      setTxSig]      = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const submitBuy = useCallback(
    async (params: BuyParams) => {
      if (!program || !provider) return;
      setError(null);

      try {
        if (!cipher.ready) await cipher.init();
        setStatus("encrypting");

        const enc   = cipher.encryptU64Pair(params.amountRequested, params.maxPrice);
        const buyer = provider.wallet.publicKey;

        const computationOffset = new anchor.BN(
          Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString()
        );

        const [childSlice] = PublicKey.findProgramAddressSync(
          [Buffer.from("child_slice"), params.slicerParentKey.toBuffer(), buyer.toBuffer(), computationOffset.toArrayLike(Buffer, "le", 8)],
          program.programId
        );

        // Subscribe BEFORE sending so no event is missed
        const resultPromise = new Promise<FillResult>((resolve, reject) => {
          const listener = program.addEventListener("matchResultEvent", (event: any) => {
            if (event.child.toBase58() !== childSlice.toBase58()) return;
            program.removeEventListener(listener);
            try {
              const nonce = Array.from(event.resultNonce) as number[];
              const [filledAmount, cost] = cipher.decryptU64Pair(
                Array.from(event.filledAmountCiphertext) as number[],
                Array.from(event.costCiphertext) as number[],
                nonce
              );
              const newVaultBalance = cipher.decryptU64(
                Array.from(event.newBalanceCiphertext) as number[],
                nonce
              );
              resolve({ filledAmount, cost, newVaultBalance });
            } catch (e) { reject(e); }
          });
          setTimeout(() => reject(new Error("MPC timeout: no result after 120s")), 120_000);
        });

        setStatus("sending");

        const sig = await program.methods
          .secureBuyRequest(
            computationOffset,
            enc.ciphertext0,
            enc.ciphertext1,
            enc.pubKey,
            enc.nonce,
          )
          .accountsPartial({
            buyer,
            slicerParent:       params.slicerParentKey,
            childSlice,
            mxeAccount:         getMXEAccAddress(program.programId),
            mempoolAccount:     getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool:      getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
            compDefAccount:     getCompDefAccAddress(program.programId, compDefOffset("match_slice")),
            clusterAccount:     getClusterAccAddress(CLUSTER_OFFSET),
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
    [program, provider, cipher]
  );

  return { submitBuy, status, txSig, fillResult, error };
}