/**
 * scripts/init-comp-defs.ts
 *
 * One-time script: initializes the three computation definition accounts
 * on devnet after deploy. Run once — comp defs persist on-chain.
 *
 * Usage:
 *   npx ts-node scripts/init-comp-defs.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getMXEAccAddress, getCompDefAccAddress, getCompDefAccOffset, } from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
const compDefOffset = (name) => {
    const offset = getCompDefAccOffset(name);
    return new DataView(offset.buffer, offset.byteOffset, offset.byteLength).getUint32(0, true);
};
// ── Config ────────────────────────────────────────────────────────
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=03bcf50e-c1f8-4cc0-a338-db4c31ffe4d6";
const PROGRAM_ID = new PublicKey("8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G");
const KEYPAIR_PATH = path.join(os.homedir(), ".config", "solana", "id.json");
async function main() {
    // Load keypair
    const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    console.log("Payer:", payer.publicKey.toBase58());
    // Load IDL
    const idlPath = path.join(__dirname, "..", "target", "idl", "arcslicer_2.json");
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
    // Set up provider
    const connection = new Connection(RPC_URL, "confirmed");
    const wallet = new anchor.Wallet(payer);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);
    const program = new Program(idl, provider);
    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    console.log("\nInitializing computation definitions on devnet...\n");
    console.log("MXE account:", mxeAccount.toBase58());
    // ── 1. init_vault_balance_comp_def ───────────────────────────────
    try {
        console.log("1/3 Initializing init_vault_balance comp def...");
        const sig1 = await program.methods
            .initVaultBalanceCompDef()
            .accountsPartial({
            payer: payer.publicKey,
            mxeAccount,
            compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset("init_vault_balance")),
        })
            .rpc({ commitment: "confirmed" });
        console.log("   ✓ Done:", sig1);
    }
    catch (e) {
        if (e.message?.includes("already in use")) {
            console.log("   ⚠ Already initialized, skipping.");
        }
        else {
            throw e;
        }
    }
    // ── 2. init_match_slice_comp_def ─────────────────────────────────
    try {
        console.log("2/3 Initializing match_slice comp def...");
        const sig2 = await program.methods
            .initMatchSliceCompDef()
            .accountsPartial({
            payer: payer.publicKey,
            mxeAccount,
            compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset("match_slice")),
        })
            .rpc({ commitment: "confirmed" });
        console.log("   ✓ Done:", sig2);
    }
    catch (e) {
        if (e.message?.includes("already in use")) {
            console.log("   ⚠ Already initialized, skipping.");
        }
        else {
            throw e;
        }
    }
    // ── 3. init_reveal_fill_comp_def ─────────────────────────────────
    try {
        console.log("3/3 Initializing reveal_fill comp def...");
        const sig3 = await program.methods
            .initRevealFillCompDef()
            .accountsPartial({
            payer: payer.publicKey,
            mxeAccount,
            compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset("reveal_fill")),
        })
            .rpc({ commitment: "confirmed" });
        console.log("   ✓ Done:", sig3);
    }
    catch (e) {
        if (e.message?.includes("already in use")) {
            console.log("   ⚠ Already initialized, skipping.");
        }
        else {
            throw e;
        }
    }
    console.log("\n✓ All comp defs initialized. Your dark pool is ready on devnet.");
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
