/**
 * useArciumCipher.ts
 *
 * Single cipher session — call this ONCE at the top level (DarkPool.tsx)
 * and pass it down to both useDepositVault and useSecureBuy.
 * If each hook creates its own session they get different shared secrets
 * and decryption breaks silently.
 */

import { useState, useCallback, useRef } from "react";
import { RescueCipher, getMXEPublicKey, x25519 } from "@arcium-hq/client";
import * as anchor from "@coral-xyz/anchor";
import { randomBytes } from "../config/constants";

export interface EncryptedU64Pair {
  ciphertext0: number[]; // [u8; 32]
  ciphertext1: number[]; // [u8; 32]
  pubKey: number[]; // [u8; 32] client x25519 public key
  nonce: anchor.BN; // u128 as BN for Anchor
  rawNonce: Uint8Array;
}

interface CipherSession {
  cipher: RescueCipher;
  publicKey: Uint8Array;
}

export function useArciumCipher(
  provider: anchor.AnchorProvider | null,
  programId: anchor.web3.PublicKey | null
) {
  const sessionRef = useRef<CipherSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (sessionRef.current) return; // already initialised
    if (!provider || !programId) return;
    try {
      const mxePubKey = await getMXEPublicKey(provider, programId);
      if (!mxePubKey) throw new Error("MXE public key not found on-chain");
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubKey);
      sessionRef.current = {
        cipher: new RescueCipher(sharedSecret),
        publicKey,
      };
      setReady(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to init Arcium cipher");
      throw e;
    }
  }, [provider, programId]);

  const encryptU64Pair = useCallback(
    (value0: bigint, value1: bigint): EncryptedU64Pair => {
      if (!sessionRef.current)
        throw new Error("Cipher not initialised — call init() first");
      const { cipher, publicKey } = sessionRef.current;
      const rawNonce = randomBytes(16);
      const ciphertexts = cipher.encrypt([value0, value1], rawNonce);
      const ct0: number[] = Array.from(
        new Uint8Array(Buffer.from(ciphertexts[0])).slice(0, 32)
      );
      const ct1: number[] = Array.from(
        new Uint8Array(Buffer.from(ciphertexts[1])).slice(0, 32)
      );
      const pk: number[] = Array.from(publicKey);
      const buf = Buffer.from(rawNonce);
      const lo = buf.readBigUInt64LE(0);
      const hi = buf.readBigUInt64LE(8);
      const u128 = new anchor.BN(
        (hi * BigInt("18446744073709551616") + lo).toString()
      );
      return {
        ciphertext0: ct0,
        ciphertext1: ct1,
        pubKey: pk,
        nonce: u128,
        rawNonce,
      };
    },
    []
  );

  const decryptU64Pair = useCallback(
    (ct0: number[], ct1: number[], nonce: number[]): [bigint, bigint] => {
      if (!sessionRef.current) throw new Error("Cipher not initialised");
      const result = sessionRef.current.cipher.decrypt(
        [ct0, ct1],
        new Uint8Array(nonce)
      );
      return [result[0], result[1]];
    },
    []
  );

  const decryptU64Triple = useCallback(
    (
      ct0: number[],
      ct1: number[],
      ct2: number[],
      nonce: number[]
    ): [bigint, bigint, bigint] => {
      if (!sessionRef.current) throw new Error("Cipher not initialised");
      const result = sessionRef.current.cipher.decrypt(
        [ct0, ct1, ct2],
        new Uint8Array(nonce)
      );
      return [result[0], result[1], result[2]];
    },
    []
  );

  return {
    init,
    ready,
    error,
    encryptU64Pair,
    decryptU64Pair,
    decryptU64Triple,
  };
}

// Exported type so hooks can accept cipher as a typed parameter
export type ArciumCipher = ReturnType<typeof useArciumCipher>;
