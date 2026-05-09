import { PublicKey } from "@solana/web3.js";

const DEFAULT_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_USDC_MINT || DEFAULT_DEVNET_USDC_MINT
);

// Deployed program ID
export const PROGRAM_ID = new PublicKey(
  "8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G"
);
