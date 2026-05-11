import { PublicKey } from "@solana/web3.js";
import { getCompDefAccOffset } from "@arcium-hq/client";

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

export const PROGRAM_ID = new PublicKey(
  "8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G"
);

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export const compDefOffset = (name: string): number => {
  const offset = getCompDefAccOffset(name);
  return new DataView(offset.buffer, offset.byteOffset, offset.byteLength).getUint32(0, true);
};
