// app/src/hooks/useArciumCipher.ts

import { useState, useCallback, useRef } from "react";
import { RescueCipher, getMXEPublicKey } from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import * as anchor from "@coral-xyz/anchor";
import { randomBytes } from "crypto";

// Anchor expects [u8; 32] which maps to number[] in TS
export interface EncryptedU64Pair {
  ciphertext0: number[];
  ciphertext1: number[];
  pubKey:      number[];
  nonce:       anchor.BN;
  rawNonce:    Uint8Array;
}

interface CipherSession {
  cipher:    RescueCipher;
  publicKey: Uint8Array;
}

export function useArciumCipher(
  provider:  anchor.AnchorProvider | null,
  programId: anchor.web3.PublicKey | null
) {
  const sessionRef = useRef<CipherSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (!provider || !programId) return;
    try {
      const mxePubKey = await getMXEPublicKey(provider, programId);
      if (!mxePubKey) throw new Error("MXE public key not found on-chain");
      const privateKey   = x25519.utils.randomSecretKey();
      const publicKey    = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubKey);
      sessionRef.current = { cipher: new RescueCipher(sharedSecret), publicKey };
      setReady(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to init Arcium cipher");
    }
  }, [provider, programId]);

  const encryptU64Pair = useCallback(
    (value0: bigint, value1: bigint): EncryptedU64Pair => {
      if (!sessionRef.current) throw new Error("Cipher not initialised");
      const { cipher, publicKey } = sessionRef.current;
      const rawNonce    = new Uint8Array(randomBytes(16));
      const ciphertexts = cipher.encrypt([value0, value1], rawNonce);
      // Force each ciphertext to number[] regardless of what the library returns
      const ct0: number[] = Array.from(new Uint8Array(Buffer.from(ciphertexts[0])).slice(0, 32));
      const ct1: number[] = Array.from(new Uint8Array(Buffer.from(ciphertexts[1])).slice(0, 32));
      const pk:  number[] = Array.from(publicKey);
      // u128: combine lo (bytes 0-7) and hi (bytes 8-15)
      const buf  = Buffer.from(rawNonce);
      const lo   = buf.readBigUInt64LE(0);
      const hi   = buf.readBigUInt64LE(8);
      const u128 = new anchor.BN((hi * BigInt("18446744073709551616") + lo).toString());
      return { ciphertext0: ct0, ciphertext1: ct1, pubKey: pk, nonce: u128, rawNonce };
    },
    []
  );

  const decryptU64Pair = useCallback(
    (ct0: number[], ct1: number[], nonce: number[]): [bigint, bigint] => {
      if (!sessionRef.current) throw new Error("Cipher not initialised");
      const result = sessionRef.current.cipher.decrypt(
        [new Uint8Array(ct0), new Uint8Array(ct1)],
        new Uint8Array(nonce)
      );
      return [result[0], result[1]];
    },
    []
  );

  return { init, ready, error, encryptU64Pair, decryptU64Pair };
}