import { PublicKey } from "@solana/web3.js";
import { getCompDefAccOffset } from "@arcium-hq/client";

// ── Fixed mints: SOL → USDC only ──────────────────────────────────
// wSOL mint (native SOL wrapped as SPL token)
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

// Devnet USDC mint
export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

// Deployed program ID
export const PROGRAM_ID = new PublicKey(
  "8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G"
);

// ── Shared helpers (single source of truth) ───────────────────────

/** Generate cryptographically random bytes in the browser */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * Convert a circuit function name to its u32 comp-def offset.
 * Mirrors the Rust comp_def_offset!() macro.
 */
export const compDefOffset = (name: string): number => {
  const offset = getCompDefAccOffset(name);
  return new DataView(offset.buffer, offset.byteOffset, offset.byteLength).getUint32(0, true);
};