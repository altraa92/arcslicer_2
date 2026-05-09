import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const RPC_URL    = "https://devnet.helius-rpc.com/?api-key=03bcf50e-c1f8-4cc0-a338-db4c31ffe4d6";
const PROGRAM_ID = new PublicKey("8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G");
const LUT_PROGRAM_ID = new PublicKey("AddressLookupTab1e1111111111111111111111111");

// lut_offset_slot decoded from raw MXE account data at byte 261
const LUT_OFFSET_SLOT = new BN(461214664);

const compDefOffset = (name) => {
  const offset = getCompDefAccOffset(name);
  return new DataView(offset.buffer, offset.byteOffset, offset.byteLength).getUint32(0, true);
};

async function main() {
  const raw   = fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  console.log("Payer:", payer.publicKey.toBase58());

  const idlPath = path.join(__dirname, "..", "target", "idl", "arcslicer_2.json");
  const idl     = JSON.parse(fs.readFileSync(idlPath, "utf8"));

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet     = new anchor.Wallet(payer);
  const provider   = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program    = new anchor.Program(idl, provider);
  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  const addressLookupTable = getLookupTableAddress(PROGRAM_ID, LUT_OFFSET_SLOT);

  console.log("MXE account:    ", mxeAccount.toBase58());
  console.log("LUT address:    ", addressLookupTable.toBase58());
  console.log("\nInitializing computation definitions on devnet...\n");

  const defs = [
    { label: "init_vault_balance", method: "initVaultBalanceCompDef" },
    { label: "match_slice",        method: "initMatchSliceCompDef"   },
    { label: "reveal_fill",        method: "initRevealFillCompDef"   },
  ];

  for (let i = 0; i < defs.length; i++) {
    const { label, method } = defs[i];
    try {
      console.log(`${i + 1}/3 Initializing ${label} comp def...`);
      const sig = await program.methods[method]()
        .accountsPartial({
          payer:               payer.publicKey,
          mxeAccount,
          compDefAccount:      getCompDefAccAddress(PROGRAM_ID, compDefOffset(label)),
          addressLookupTable,
          lutProgram:          LUT_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`   ✓ Done: ${sig}`);
    } catch (e) {
      if (e.message?.includes("already in use")) {
        console.log("   ⚠ Already initialized, skipping.");
      } else {
        throw e;
      }
    }
  }

  console.log("\n✓ All comp defs initialized. Your dark pool is ready on devnet.");
}

main().catch((e) => { console.error(e); process.exit(1); });