import { useState, useCallback, useRef } from "react";
import { RescueCipher, getMXEPublicKey, x25519 } from "@arcium-hq/client";
import * as anchor from "@coral-xyz/anchor";
import { randomBytes } from "../config/constants";

export interface EncryptedU64Pair {
  ciphertext0: number[];
  ciphertext1: number[];
  pubKey: number[];
  nonce: anchor.BN;
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
    if (sessionRef.current) return;
    if (!provider || !programId) return;
    try {
      const mxePubKey = await getMXEPublicKey(provider, programId);
      if (!mxePubKey) throw new Error("Encryption setup is not ready yet.");
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubKey);
      sessionRef.current = {
        cipher: new RescueCipher(sharedSecret),
        publicKey,
      };
      setReady(true);
    } catch (e: any) {
      setError(e?.message ?? "Could not prepare encryption. Please try again.");
      throw e;
    }
  }, [provider, programId]);

  const encryptU64Pair = useCallback(
    (value0: bigint, value1: bigint): EncryptedU64Pair => {
      if (!sessionRef.current)
        throw new Error("Encryption is not ready yet. Please try again.");
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

  const encryptU64Array = useCallback((values: bigint[]): EncryptedU64Pair & { ciphertexts: number[][] } => {
    if (!sessionRef.current)
      throw new Error("Encryption is not ready yet. Please try again.");
    const { cipher, publicKey } = sessionRef.current;
    const rawNonce = randomBytes(16);
    const ciphertexts = cipher.encrypt(values, rawNonce).map((ciphertext) =>
      Array.from(new Uint8Array(Buffer.from(ciphertext)).slice(0, 32))
    );
    const buf = Buffer.from(rawNonce);
    const lo = buf.readBigUInt64LE(0);
    const hi = buf.readBigUInt64LE(8);
    const nonce = new anchor.BN(
      (hi * BigInt("18446744073709551616") + lo).toString()
    );
    return {
      ciphertext0: ciphertexts[0],
      ciphertext1: ciphertexts[1],
      ciphertexts,
      pubKey: Array.from(publicKey),
      nonce,
      rawNonce,
    };
  }, []);

  const decryptU64Pair = useCallback(
    (ct0: number[], ct1: number[], nonce: number[]): [bigint, bigint] => {
      if (!sessionRef.current) throw new Error("Encryption is not ready yet.");
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
      if (!sessionRef.current) throw new Error("Encryption is not ready yet.");
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
    encryptU64Array,
    decryptU64Pair,
    decryptU64Triple,
  };
}

export type ArciumCipher = ReturnType<typeof useArciumCipher>;
