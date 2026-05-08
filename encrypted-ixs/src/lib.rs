// encrypted-ixs/src/lib.rs
// ─────────────────────────────────────────────────────────────────
// Dark Pool Arcis circuits.
// NOTE: all circuit code must live inside `#[encrypted] mod circuits`.
// This is what arcium build compiles into ComputationDefinitionAccounts.
//
// Three circuits:
//   1. init_vault_balance  — re-encrypt whale's vault under MXE key
//   2. match_slice         — dark-pool fill logic (price check + fill)
//   3. reveal_fill         — re-encrypt fill result back to whale
// ─────────────────────────────────────────────────────────────────

use arcis::prelude::*;

#[encrypted]
mod circuits {
    use arcis::prelude::*;

    // ── Shared data shapes ────────────────────────────────────────

    /// Whale's vault: stored encrypted on-chain under MXE key
    pub struct VaultState {
        pub remaining_balance: u64,
        pub price_per_token:   u64,
    }

    /// Buyer's order: encrypted client-side under Shared key
    pub struct BuyRequest {
        pub amount_requested: u64,
        pub max_price:        u64,
    }

    /// Fill result: returned encrypted to the buyer
    pub struct MatchResult {
        pub filled_amount:     u64,
        pub cost:              u64,
        pub new_vault_balance: u64,
    }

    // ── 1. init_vault_balance ─────────────────────────────────────
    // Whale calls this once on deposit.
    // Input:  Enc<Shared, VaultState>  (frontend encrypts with RescueCipher)
    // Output: Enc<Mxe, VaultState>     (only the MPC cluster can read this)
    #[instruction]
    pub fn init_vault_balance(
        vault_ctxt: Enc<Shared, VaultState>,
    ) -> Enc<Mxe, VaultState> {
        let vault = vault_ctxt.to_arcis();
        Mxe::from_arcis(VaultState {
            remaining_balance: vault.remaining_balance,
            price_per_token:   vault.price_per_token,
        })
    }

    // ── 2. match_slice ────────────────────────────────────────────
    // Core dark-pool matching. Both branches always execute (MPC
    // requirement to prevent side-channel leaks — compiler handles this).
    //
    // Input:  Enc<Mxe, VaultState>   (from on-chain stored ciphertext)
    //         Enc<Shared, BuyRequest> (buyer encrypts client-side)
    // Output: Enc<Shared, MatchResult> (buyer decrypts this)
    //         Enc<Mxe, VaultState>     (updated vault stays encrypted)
    #[instruction]
    pub fn match_slice(
        vault_ctxt:   Enc<Mxe, VaultState>,
        request_ctxt: Enc<Shared, BuyRequest>,
    ) -> (Enc<Shared, MatchResult>, Enc<Mxe, VaultState>) {
        let vault = vault_ctxt.to_arcis();
        let req   = request_ctxt.to_arcis();

        let price_ok: bool  = req.max_price >= vault.price_per_token;
        let available: u64  = if price_ok { vault.remaining_balance } else { 0u64 };
        let fill: u64       = if req.amount_requested < available {
            req.amount_requested
        } else {
            available
        };

        let cost:        u64 = fill * vault.price_per_token;
        let new_balance: u64 = vault.remaining_balance - fill;

        (
            request_ctxt.owner.from_arcis(MatchResult {
                filled_amount:     fill,
                cost,
                new_vault_balance: new_balance,
            }),
            Mxe::from_arcis(VaultState {
                remaining_balance: new_balance,
                price_per_token:   vault.price_per_token,
            }),
        )
    }

    // ── 3. reveal_fill ────────────────────────────────────────────
    // Optional: lets the whale see aggregate fill data.
    // Re-encrypts the MXE-held MatchResult under the whale's shared key.
    #[instruction]
    pub fn reveal_fill(
        result_ctxt: Enc<Mxe, MatchResult>,
        owner_ctxt:  Enc<Shared, u64>, // binds owner's x25519 pubkey
    ) -> Enc<Shared, MatchResult> {
        let result = result_ctxt.to_arcis();
        owner_ctxt.owner.from_arcis(result)
    }
}