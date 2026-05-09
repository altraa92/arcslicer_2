import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DECIMALS = 6;
const INITIAL_FAUCET_UNITS = 1_000_000n;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing .env at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const values = new Map();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values.set(key, value);
  }

  return { raw, values };
}

function upsertEnv(raw, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(raw)) {
    return raw.replace(pattern, line);
  }

  return raw.endsWith("\n") ? `${raw}${line}\n` : `${raw}\n${line}\n`;
}

function faucetKeypairFromEnv(secretKeyString) {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyString)));
  } catch (error) {
    throw new Error(`VITE_FAUCET_SECRET_KEY must be a JSON array secret key. ${error.message}`);
  }
}

async function main() {
  const { raw, values } = readEnvFile(envPath);
  const rpcUrl = values.get("VITE_RPC_URL") || DEFAULT_RPC;
  const faucetSecret = values.get("VITE_FAUCET_SECRET_KEY");

  if (!faucetSecret) {
    throw new Error("VITE_FAUCET_SECRET_KEY is required in .env");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const faucet = faucetKeypairFromEnv(faucetSecret);
  const existingMint = values.get("VITE_USDC_MINT");

  if (existingMint) {
    const mint = new PublicKey(existingMint);
    const mintInfo = await getMint(connection, mint);

    if (mintInfo.mintAuthority?.equals(faucet.publicKey)) {
      console.log(`Existing VITE_USDC_MINT is already controlled by faucet: ${mint.toBase58()}`);
      return;
    }

    console.log(`Existing VITE_USDC_MINT is not controlled by faucet: ${mint.toBase58()}`);
    console.log("Creating a new faucet-controlled mint...");
  }

  const mint = await createMint(
    connection,
    faucet,
    faucet.publicKey,
    null,
    DECIMALS
  );

  const faucetTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    faucet,
    mint,
    faucet.publicKey
  );

  const mintAmount = INITIAL_FAUCET_UNITS * 10n ** BigInt(DECIMALS);
  await mintTo(
    connection,
    faucet,
    mint,
    faucetTokenAccount.address,
    faucet.publicKey,
    mintAmount
  );

  fs.writeFileSync(envPath, upsertEnv(raw, "VITE_USDC_MINT", mint.toBase58()));

  console.log(`Created faucet-controlled token mint: ${mint.toBase58()}`);
  console.log(`Faucet token account: ${faucetTokenAccount.address.toBase58()}`);
  console.log(`Minted ${INITIAL_FAUCET_UNITS.toString()} units to the faucet token account.`);
  console.log("Updated .env with VITE_USDC_MINT. Restart yarn dev so Vite picks it up.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
