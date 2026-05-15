import { useCallback, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  awaitComputationFinalization,
  getClusterAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";
import { type ArciumCipher } from "./useArciumCipher";
import { compDefOffset, randomBytes, USDC_MINT, WSOL_MINT } from "../config/constants";

const CLUSTER_OFFSET = 456;
const POOL_BOOK_VALUES = 8;
const MIN_BUYER_SOL_BALANCE = 0.01 * LAMPORTS_PER_SOL;
const SLOT_CONFIRM_RETRIES = 12;
const SLOT_CONFIRM_DELAY_MS = 1500;

export type PoolStatus =
  | "idle"
  | "encrypting"
  | "sending"
  | "waiting"
  | "finalizing"
  | "settling"
  | "done"
  | "error";

export interface PoolSnapshot {
  poolBook: PublicKey;
  poolWsolVault: PublicKey;
  poolUsdcVault: PublicKey;
  poolSolVaultBalance: bigint;
  poolUsdcVaultBalance: bigint;
  isInitialized: boolean;
  isMatching: boolean;
  occupiedSlots: number;
  externalSlots: number;
  activeSlots: number;
  mySlot: number | null;
  myRawCredit: bigint;
  myCredit: bigint;
  myPendingCredit: bigint;
  myFilledLamports: bigint;
}

export interface PoolFillResult {
  filledAmount: bigint;
  cost: bigint;
}

export interface PoolBuyReceipt extends PoolFillResult {
  txSig: string;
}

interface DepositParams {
  depositLamports: bigint;
  pricePerToken: bigint;
  urgencyLevel: 1 | 2 | 3;
}

interface BuyParams {
  amountRequested: bigint;
  maxPrice: bigint;
}

const friendlyPoolError = (e: any) => {
  const message = e?.message ?? String(e ?? "");
  if (/user rejected|rejected/i.test(message)) return "Transaction cancelled.";
  if (/insufficient lamports/i.test(message)) {
    return "This wallet needs more devnet SOL for fees. Add SOL and try again.";
  }
  if (/insufficient funds|0x1/i.test(message)) {
    return "A token balance changed before settlement. Refresh the pool and try again.";
  }
  if (/PoolFull/i.test(message)) {
    return "The private pool is full. Try again after an order fills or withdraws.";
  }
  if (/PoolBusy/i.test(message)) {
    return "The private pool is matching another order. Try again in a moment.";
  }
  if (/OwnPoolLiquidityActive/i.test(message)) {
    return "This wallet already has a seller slot. Use another wallet to buy, or cancel your sell slot first.";
  }
  if (/NoExternalPoolLiquidity/i.test(message)) {
    return "No external seller liquidity is available for this wallet yet.";
  }
  if (/NoPoolLiquidity/i.test(message)) {
    return "No private liquidity is available right now. Wait for a seller to add SOL.";
  }
  if (/NothingToSettle/i.test(message)) {
    return "No SOL was available at execution time. Refresh and try again after new liquidity appears.";
  }
  if (/SellerCreditPendingSettlement/i.test(message)) {
    return "Seller USDC is still settling. Refresh in a moment.";
  }
  if (/blockhash|timeout|timed out/i.test(message)) {
    return "The network took too long to respond. Please try again.";
  }
  return message || "Private pool action failed. Please try again.";
};

const getPoolAddresses = (programId: PublicKey) => {
  const [poolBook] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_book")],
    programId
  );
  const [poolWsolVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_wsol_vault"), poolBook.toBuffer()],
    programId
  );
  const [poolUsdcVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_usdc_vault"), poolBook.toBuffer()],
    programId
  );
  return { poolBook, poolWsolVault, poolUsdcVault };
};

const newOffset = () =>
  new anchor.BN(Buffer.from(randomBytes(8)).readBigUInt64LE(0).toString());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readTokenAmount = async (
  connection: anchor.web3.Connection,
  address: PublicKey
) => {
  try {
    return (await getAccount(connection, address)).amount;
  } catch {
    return 0n;
  }
};

export function usePrivatePool(
  program: anchor.Program<any> | null,
  provider: anchor.AnchorProvider | null,
  cipher: ArciumCipher
) {
  const [depositStatus, setDepositStatus] = useState<PoolStatus>("idle");
  const [buyStatus, setBuyStatus] = useState<PoolStatus>("idle");
  const [manageStatus, setManageStatus] = useState<PoolStatus>("idle");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [fillResult, setFillResult] = useState<PoolFillResult | null>(null);
  const [lastBuyReceipt, setLastBuyReceipt] = useState<PoolBuyReceipt | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const fetchPool = useCallback(async (): Promise<PoolSnapshot | null> => {
    if (!program || !provider) return null;
    const { poolBook, poolWsolVault, poolUsdcVault } = getPoolAddresses(
      program.programId
    );
    try {
      const account = await (program.account as any).poolBook.fetch(poolBook);
      const owners = account.owners as PublicKey[];
      const occupied = account.occupied as boolean[];
      const myKey = provider.wallet.publicKey.toBase58();
      const [poolSolVaultBalance, poolUsdcVaultBalance] = await Promise.all([
        readTokenAmount(provider.connection, poolWsolVault),
        readTokenAmount(provider.connection, poolUsdcVault),
      ]);
      const occupiedSlots = occupied.filter(Boolean).length;
      const mySlot = owners.findIndex(
        (owner, i) => occupied[i] && owner.toBase58() === myKey
      );
      const externalSlots = occupied.filter(
        (isOccupied, i) => isOccupied && owners[i].toBase58() !== myKey
      ).length;
      const rawCredit =
        mySlot >= 0 ? BigInt(account.accruedUsdc[mySlot].toString()) : 0n;
      const credit =
        rawCredit < poolUsdcVaultBalance ? rawCredit : poolUsdcVaultBalance;
      let myFilledLamports = 0n;
      if (mySlot >= 0) {
        try {
          const fills = await (program.account as any).poolFill.all();
          for (const fill of fills) {
            const fillAccount = fill.account as any;
            if (!fillAccount.isSettled) continue;
            if (!fillAccount.pool.equals(poolBook)) continue;
            myFilledLamports += BigInt(fillAccount.slotFills[mySlot].toString());
          }
        } catch (error) {
          console.warn("Could not read pool fill history:", error);
          myFilledLamports = 0n;
        }
      }
      return {
        poolBook,
        poolWsolVault,
        poolUsdcVault,
        poolSolVaultBalance,
        poolUsdcVaultBalance,
        isInitialized: Boolean(account.isInitialized),
        isMatching: Boolean(account.isMatching),
        occupiedSlots,
        externalSlots:
          poolSolVaultBalance > 0n ? externalSlots : 0,
        activeSlots:
          poolSolVaultBalance > 0n ? occupiedSlots : 0,
        mySlot: mySlot >= 0 ? mySlot : null,
        myRawCredit: rawCredit,
        myCredit: credit,
        myPendingCredit: rawCredit > credit ? rawCredit - credit : 0n,
        myFilledLamports,
      };
    } catch {
      return null;
    }
  }, [program, provider]);

  const ensurePool = useCallback(async () => {
    if (!program || !provider) throw new Error("Connect wallet first.");
    const { poolBook, poolWsolVault, poolUsdcVault } = getPoolAddresses(
      program.programId
    );
    const authority = provider.wallet.publicKey;
    const existing = await fetchPool();

    if (!existing) {
      await program.methods
        .initializePool()
        .accountsPartial({
          authority,
          poolBook,
          solMint: WSOL_MINT,
          usdcMint: USDC_MINT,
          poolWsolVault,
          poolUsdcVault,
        })
        .rpc({ commitment: "confirmed" });
    }

    const pool = (await fetchPool()) ?? {
      isInitialized: false,
      poolBook,
      poolWsolVault,
      poolUsdcVault,
    };
    if (pool.isInitialized) return { poolBook, poolWsolVault, poolUsdcVault };

    if (!cipher.ready) await cipher.init();
    const enc = cipher.encryptU64Array(Array(POOL_BOOK_VALUES).fill(0n));
    const computationOffset = newOffset();
    await program.methods
      .initPoolBook(
        computationOffset,
        enc.ciphertexts,
        enc.pubKey,
        enc.nonce
      )
      .accountsPartial({
        authority,
        poolBook,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        computationAccount: getComputationAccAddress(
          CLUSTER_OFFSET,
          computationOffset
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          compDefOffset("init_pool_book")
        ),
        clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      })
      .rpc({ commitment: "confirmed" });
    await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    return { poolBook, poolWsolVault, poolUsdcVault };
  }, [program, provider, cipher, fetchPool]);

  const waitForOwnedSlot = useCallback(async () => {
    for (let attempt = 0; attempt < SLOT_CONFIRM_RETRIES; attempt++) {
      const snapshot = await fetchPool();
      if (snapshot?.mySlot !== null && snapshot?.mySlot !== undefined) {
        return snapshot;
      }
      await sleep(SLOT_CONFIRM_DELAY_MS);
    }
    throw new Error(
      "Your deposit transaction completed, but the private pool slot was not confirmed. Refresh in a moment; if it stays missing, the Arcium callback did not complete."
    );
  }, [fetchPool]);

  const deposit = useCallback(
    async (params: DepositParams) => {
      if (!program || !provider) return;
      setDepositError(null);
      try {
        setDepositStatus("encrypting");
        if (!cipher.ready) await cipher.init();
        const { poolBook, poolWsolVault } = await ensurePool();
        const owner = provider.wallet.publicKey;
        const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, owner);

        const setupTx = new Transaction();
        const wsolInfo = await provider.connection.getAccountInfo(wsolAta);
        if (!wsolInfo) {
          setupTx.add(
            createAssociatedTokenAccountInstruction(
              owner,
              wsolAta,
              owner,
              WSOL_MINT
            )
          );
        }
        setupTx.add(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: wsolAta,
            lamports: Number(params.depositLamports),
          }),
          createSyncNativeInstruction(wsolAta)
        );
        const { blockhash } = await provider.connection.getLatestBlockhash();
        setupTx.recentBlockhash = blockhash;
        setupTx.feePayer = owner;
        const signedSetup = await provider.wallet.signTransaction(setupTx);
        await provider.connection.sendRawTransaction(signedSetup.serialize(), {
          skipPreflight: false,
        });

        const enc = cipher.encryptU64Pair(
          params.depositLamports,
          params.pricePerToken
        );
        const computationOffset = newOffset();
        const [depositTicket] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool_deposit"),
            owner.toBuffer(),
            computationOffset.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        setDepositStatus("sending");
        const sig = await program.methods
          .depositPoolOrder(
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
            poolBook,
            poolWsolVault,
            depositorTokenAccount: wsolAta,
            depositTicket,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount: getComputationAccAddress(
              CLUSTER_OFFSET,
              computationOffset
            ),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              compDefOffset("add_pool_order")
            ),
            clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          })
          .rpc({ commitment: "confirmed" });
        setTxSig(sig);
        setDepositStatus("waiting");
        await awaitComputationFinalization(
          provider,
          computationOffset,
          program.programId,
          "confirmed"
        );
        await waitForOwnedSlot();
        setDepositStatus("done");
      } catch (e: any) {
        setDepositError(friendlyPoolError(e));
        setDepositStatus("error");
      }
    },
    [program, provider, cipher, ensurePool, waitForOwnedSlot]
  );

  const buy = useCallback(
    async (params: BuyParams) => {
      if (!program || !provider) return;
      setBuyError(null);
      setFillResult(null);
      setLastBuyReceipt(null);
      try {
        setBuyStatus("encrypting");
        if (!cipher.ready) await cipher.init();
        const { poolBook, poolWsolVault, poolUsdcVault } = await ensurePool();
        const snapshot = await fetchPool();
        if (snapshot?.mySlot !== null && snapshot?.mySlot !== undefined) {
          throw new Error("OwnPoolLiquidityActive");
        }
        if (
          !snapshot ||
          snapshot.poolSolVaultBalance === 0n ||
          snapshot.externalSlots === 0
        ) {
          throw new Error("NoExternalPoolLiquidity");
        }
        const buyer = provider.wallet.publicKey;
        const buyerLamports = await provider.connection.getBalance(
          buyer,
          "confirmed"
        );
        if (buyerLamports < MIN_BUYER_SOL_BALANCE) {
          throw new Error("Add devnet SOL before buying.");
        }

        const buyerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, buyer);
        if (!(await provider.connection.getAccountInfo(buyerUsdcAta))) {
          const tx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              buyer,
              buyerUsdcAta,
              buyer,
              USDC_MINT
            )
          );
          const { blockhash } = await provider.connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = buyer;
          const signed = await provider.wallet.signTransaction(tx);
          await provider.connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
          });
        }

        const maxCost =
          (params.amountRequested * params.maxPrice) / 1_000_000_000n;
        const buyerUsdcBeforeMatch = await getAccount(
          provider.connection,
          buyerUsdcAta
        );
        if (buyerUsdcBeforeMatch.amount < maxCost) {
          throw new Error(
            `Buyer USDC balance is too low. Need up to ${(
              Number(maxCost) / 1e6
            ).toFixed(6)} USDC.`
          );
        }

        const enc = cipher.encryptU64Pair(
          params.amountRequested,
          params.maxPrice
        );
        const computationOffset = newOffset();
        const [poolFill] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool_fill"),
            poolBook.toBuffer(),
            buyer.toBuffer(),
            computationOffset.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        const resultPromise = new Promise<PoolFillResult>((resolve, reject) => {
          const listener = program.addEventListener(
            "poolMatchResultEvent",
            (event: any) => {
              if (event.fill.toBase58() !== poolFill.toBase58()) return;
              program.removeEventListener(listener);
              try {
                const [filledAmount, cost] = cipher.decryptU64Pair(
                  Array.from(event.filledAmountCiphertext) as number[],
                  Array.from(event.costCiphertext) as number[],
                  Array.from(event.resultNonce) as number[]
                );
                resolve({ filledAmount, cost });
              } catch (error) {
                reject(error);
              }
            }
          );
          setTimeout(
            () => reject(new Error("The private match is taking longer than expected.")),
            120_000
          );
        });

        setBuyStatus("sending");
        const sig = await program.methods
          .securePoolBuyRequest(
            computationOffset,
            enc.ciphertext0,
            enc.ciphertext1,
            enc.pubKey,
            enc.nonce
          )
          .accountsPartial({
            buyer,
            poolBook,
            poolFill,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount: getComputationAccAddress(
              CLUSTER_OFFSET,
              computationOffset
            ),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              compDefOffset("match_pool_v2")
            ),
            clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          })
          .rpc({ commitment: "confirmed" });
        setTxSig(sig);
        setBuyStatus("waiting");
        await awaitComputationFinalization(
          provider,
          computationOffset,
          program.programId,
          "confirmed"
        );

        const result = await resultPromise;
        setFillResult(result);
        if (result.filledAmount === 0n) {
          setLastBuyReceipt({ ...result, txSig: sig });
          setBuyStatus("done");
          return;
        }

        setBuyStatus("finalizing");
        await program.methods
          .finalizePoolFill()
          .accountsPartial({ buyer, poolFill })
          .rpc({ commitment: "confirmed" });

        const buyerWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, buyer);
        const setupTx = new Transaction();
        if (!(await provider.connection.getAccountInfo(buyerWsolAta))) {
          setupTx.add(
            createAssociatedTokenAccountInstruction(
              buyer,
              buyerWsolAta,
              buyer,
              NATIVE_MINT
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

        const buyerUsdc = await getAccount(provider.connection, buyerUsdcAta);
        if (buyerUsdc.amount < result.cost) {
          throw new Error(
            `Buyer USDC balance is too low. Need ${(
              Number(result.cost) / 1e6
            ).toFixed(6)} USDC.`
          );
        }

        setBuyStatus("settling");
        const settleSig = await program.methods
          .settlePoolFill()
          .accountsPartial({
            buyer,
            poolBook,
            poolFill,
            poolWsolVault,
            poolUsdcVault,
            buyerWsolAta,
            buyerUsdcAta,
          })
          .rpc({ commitment: "confirmed" });
        setTxSig(settleSig);

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
        setLastBuyReceipt({ ...result, txSig: settleSig });
        setBuyStatus("done");
      } catch (e: any) {
        setBuyError(friendlyPoolError(e));
        setBuyStatus("error");
      }
    },
    [program, provider, cipher, ensurePool]
  );

  const withdrawCredit = useCallback(
    async (slot: number) => {
      if (!program || !provider) return;
      setManageError(null);
      try {
        setManageStatus("sending");
        const { poolBook, poolUsdcVault } = await ensurePool();
        const owner = provider.wallet.publicKey;
        const ownerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, owner);
        if (!(await provider.connection.getAccountInfo(ownerUsdcAta))) {
          const tx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              owner,
              ownerUsdcAta,
              owner,
              USDC_MINT
            )
          );
          const { blockhash } = await provider.connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = owner;
          const signed = await provider.wallet.signTransaction(tx);
          await provider.connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
          });
        }
        await program.methods
          .withdrawPoolSellerCredit(slot)
          .accountsPartial({
            owner,
            poolBook,
            poolUsdcVault,
            ownerUsdcAta,
          })
          .rpc({ commitment: "confirmed" });
        setManageStatus("done");
      } catch (e: any) {
        setManageError(friendlyPoolError(e));
        setManageStatus("error");
      }
    },
    [program, provider, ensurePool]
  );

  const cancelAndWithdraw = useCallback(
    async (slot: number) => {
      if (!program || !provider) return;
      setManageError(null);
      try {
        setManageStatus("sending");
        const { poolBook, poolWsolVault } = await ensurePool();
        const owner = provider.wallet.publicKey;
        const computationOffset = newOffset();
        const [cancelTicket] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("pool_cancel"),
            owner.toBuffer(),
            computationOffset.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );
        await program.methods
          .requestCancelPoolOrder(computationOffset, slot)
          .accountsPartial({
            owner,
            poolBook,
            cancelTicket,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
            computationAccount: getComputationAccAddress(
              CLUSTER_OFFSET,
              computationOffset
            ),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              compDefOffset("cancel_pool_order")
            ),
            clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          })
          .rpc({ commitment: "confirmed" });
        setManageStatus("waiting");
        await awaitComputationFinalization(
          provider,
          computationOffset,
          program.programId,
          "confirmed"
        );

        const ownerTokenAccount = getAssociatedTokenAddressSync(WSOL_MINT, owner);
        if (!(await provider.connection.getAccountInfo(ownerTokenAccount))) {
          const tx = new Transaction().add(
            createAssociatedTokenAccountInstruction(
              owner,
              ownerTokenAccount,
              owner,
              WSOL_MINT
            )
          );
          const { blockhash } = await provider.connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = owner;
          const signed = await provider.wallet.signTransaction(tx);
          await provider.connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
          });
        }

        await program.methods
          .withdrawCancelledPoolOrder()
          .accountsPartial({
            owner,
            poolBook,
            poolWsolVault,
            cancelTicket,
            ownerTokenAccount,
          })
          .rpc({ commitment: "confirmed" });

        const closeTx = new Transaction().add(
          createCloseAccountInstruction(ownerTokenAccount, owner, owner)
        );
        const { blockhash } = await provider.connection.getLatestBlockhash();
        closeTx.recentBlockhash = blockhash;
        closeTx.feePayer = owner;
        const signedClose = await provider.wallet.signTransaction(closeTx);
        await provider.connection.sendRawTransaction(signedClose.serialize(), {
          skipPreflight: false,
        });
        setManageStatus("done");
      } catch (e: any) {
        setManageError(friendlyPoolError(e));
        setManageStatus("error");
      }
    },
    [program, provider, ensurePool]
  );

  return {
    fetchPool,
    ensurePool,
    deposit,
    buy,
    withdrawCredit,
    cancelAndWithdraw,
    depositStatus,
    buyStatus,
    manageStatus,
    depositError,
    buyError,
    manageError,
    fillResult,
    lastBuyReceipt,
    txSig,
  };
}
