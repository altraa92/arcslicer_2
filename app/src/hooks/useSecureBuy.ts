/**
 * useSecureBuy.ts
 *
 * Buyer flow:
 *  1. Encrypt order (amount + max price)
 *  2. Submit secure_buy_request → Arcium queues match_slice_v2
 *  3. Wait for MatchResultEvent, decrypt fill result
 *  4. finalize_fill — acknowledges the plaintext result stored by the callback
 *  5. settle — transfers wSOL from vault → buyer, USDC from buyer → seller
 *  6. closeAccount — unwraps buyer's wSOL ATA → native SOL in wallet
 */

import { useState, useCallback } from "react";
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  getAccount,
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
import { randomBytes, compDefOffset, USDC_MINT } from "../config/constants";

const CLUSTER_OFFSET = 456;
const MIN_BUYER_SOL_BALANCE = 0.01 * LAMPORTS_PER_SOL;

export type BuyStatus =
  | "idle"
  | "encrypting"
  | "sending"
  | "waiting"
  | "finalizing"
  | "settling"
  | "done"
  | "error";

export interface FillResult {
  filledAmount: bigint;
  cost: bigint;
  newVaultBalance: bigint;
}

interface BuyParams {
  slicerParentKey: PublicKey;
  amountRequested: bigint;
  maxPrice: bigint;
}

export function useSecureBuy(
  program: anchor.Program<any> | null,
  provider: anchor.AnchorProvider | null,
  cipher: ArciumCipher
) {
  const [status, setStatus] = useState<BuyStatus>("idle");
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settleFilledChild = useCallback(
    async (
      childSlice: PublicKey,
      slicerParentKey: PublicKey,
      expectedCost: bigint
    ) => {
      if (!program || !provider) return;

      const buyer = provider.wallet.publicKey;
      const buyerWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, buyer);
      const buyerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, buyer);

      const vaultAcc = await (program.account as any).slicerParent.fetch(
        slicerParentKey
      );
      const sellerKey = vaultAcc.owner as PublicKey;
      const sellerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, sellerKey);

      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          sellerKey.toBuffer(),
          (vaultAcc.mint as PublicKey).toBuffer(),
        ],
        program.programId
      );

      const setupTx = new Transaction();
      const wsolAtaInfo = await provider.connection.getAccountInfo(
        buyerWsolAta
      );
      if (!wsolAtaInfo) {
        setupTx.add(
          createAssociatedTokenAccountInstruction(
            buyer,
            buyerWsolAta,
            buyer,
            NATIVE_MINT
          )
        );
      }

      const buyerUsdcInfo = await provider.connection.getAccountInfo(
        buyerUsdcAta
      );
      if (!buyerUsdcInfo) {
        setupTx.add(
          createAssociatedTokenAccountInstruction(
            buyer,
            buyerUsdcAta,
            buyer,
            USDC_MINT
          )
        );
      }

      const sellerUsdcInfo = await provider.connection.getAccountInfo(
        sellerUsdcAta
      );
      if (!sellerUsdcInfo) {
        setupTx.add(
          createAssociatedTokenAccountInstruction(
            buyer,
            sellerUsdcAta,
            sellerKey,
            USDC_MINT
          )
        );
      }

      if (setupTx.instructions.length > 0) {
        const { blockhash } = await provider.connection.getLatestBlockhash();
        setupTx.recentBlockhash = blockhash;
        setupTx.feePayer = buyer;
        const signed = await provider.wallet.signTransaction(setupTx);
        await provider.connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
      }

      const buyerUsdcAccount = await getAccount(
        provider.connection,
        buyerUsdcAta
      );
      if (buyerUsdcAccount.amount < expectedCost) {
        throw new Error(
          `Buyer USDC balance is too low. Need ${(
            Number(expectedCost) / 1e6
          ).toFixed(6)} USDC for this fill.`
        );
      }

      await program.methods
        .settle()
        .accountsPartial({
          buyer,
          childSlice,
          slicerParent: slicerParentKey,
          vaultTokenAccount,
          buyerWsolAta,
          buyerUsdcAta,
          sellerUsdcAta,
        })
        .rpc({ commitment: "confirmed" });

      const closeTx = new Transaction().add(
        createCloseAccountInstruction(buyerWsolAta, buyer, buyer)
      );
      const { blockhash } = await provider.connection.getLatestBlockhash();
      closeTx.recentBlockhash = blockhash;
      closeTx.feePayer = buyer;
      const signedClose = await provider.wallet.signTransaction(closeTx);
      await provider.connection.sendRawTransaction(signedClose.serialize(), {
        skipPreflight: false,
      });
    },
    [program, provider]
  );

  const submitBuy = useCallback(
    async (params: BuyParams) => {
      if (!program || !provider) return;
      setError(null);
      setFillResult(null);

      try {
        // ── 1. Encrypt ────────────────────────────────────────────
        if (!cipher.ready) await cipher.init();
        setStatus("encrypting");

        const enc = cipher.encryptU64Pair(
          params.amountRequested,
          params.maxPrice
        );
        const buyer = provider.wallet.publicKey;
        const buyerLamports = await provider.connection.getBalance(
          buyer,
          "confirmed"
        );
        if (buyerLamports < MIN_BUYER_SOL_BALANCE) {
          throw new Error(
            `Buyer wallet has ${(buyerLamports / LAMPORTS_PER_SOL).toFixed(
              4
            )} SOL. Arcium queueing needs about 0.006 SOL plus fees, so fund this wallet with devnet SOL first.`
          );
        }

        const computationOffset = new anchor.BN(
          Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString()
        );

        const [childSlice] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("child_slice"),
            params.slicerParentKey.toBuffer(),
            buyer.toBuffer(),
            computationOffset.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        // ── 2. Subscribe to event before sending ─────────────────
        const resultPromise = new Promise<FillResult>((resolve, reject) => {
          const listener = program.addEventListener(
            "matchResultEvent",
            (event: any) => {
              if (event.child.toBase58() !== childSlice.toBase58()) return;
              program.removeEventListener(listener);
              try {
                const nonce = Array.from(event.resultNonce) as number[];
                const [filledAmount, cost, newVaultBalance] =
                  cipher.decryptU64Triple(
                    Array.from(event.filledAmountCiphertext) as number[],
                    Array.from(event.costCiphertext) as number[],
                    Array.from(event.newBalanceCiphertext) as number[],
                    nonce
                  );
                resolve({ filledAmount, cost, newVaultBalance });
              } catch (e) {
                reject(e);
              }
            }
          );
          setTimeout(
            () => reject(new Error("MPC timeout: no result after 120s")),
            120_000
          );
        });

        setStatus("sending");

        // ── 3. Submit buy request ─────────────────────────────────
        const sig = await program.methods
          .secureBuyRequest(
            computationOffset,
            enc.ciphertext0,
            enc.ciphertext1,
            enc.pubKey,
            enc.nonce
          )
          .accountsPartial({
            buyer,
            slicerParent: params.slicerParentKey,
            childSlice,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount: getComputationAccAddress(
              CLUSTER_OFFSET,
              computationOffset
            ),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              compDefOffset("match_slice_v2")
            ),
            clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          })
          .rpc({ commitment: "confirmed" });

        setTxSig(sig);
        setStatus("waiting");

        // ── 4. Wait for MPC + decrypt ─────────────────────────────
        await awaitComputationFinalization(
          provider,
          computationOffset,
          program.programId,
          "confirmed"
        );

        const result = await resultPromise;
        setFillResult(result);

        // No fill — nothing to settle
        if (result.filledAmount === 0n) {
          setStatus("done");
          return;
        }

        setStatus("finalizing");

        // ── 5. finalize_fill — acknowledge callback result ────────
        await program.methods
          .finalizeFill()
          .accountsPartial({
            buyer,
            childSlice,
            slicerParent: params.slicerParentKey,
          })
          .rpc({ commitment: "confirmed" });

        setStatus("settling");

        // ── 6. settle — transfer tokens and unwrap received wSOL ──
        await settleFilledChild(childSlice, params.slicerParentKey, result.cost);

        setStatus("done");
      } catch (e: any) {
        setError(e?.message ?? "Unknown error");
        setStatus("error");
      }
    },
    [program, provider, cipher, settleFilledChild]
  );

  return { submitBuy, status, txSig, fillResult, error };
}
