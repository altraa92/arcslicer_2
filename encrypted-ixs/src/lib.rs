use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    // Shared data shapes

    /// Whale's vault: stored encrypted on-chain under MXE key
    pub struct VaultState {
        pub remaining_balance: u64,
        pub price_per_token: u64,
    }

    /// Buyer's order: encrypted client-side under Shared key
    pub struct BuyRequest {
        pub amount_requested: u64,
        pub max_price: u64,
    }

    /// Fill result: returned encrypted to the buyer
    pub struct MatchResult {
        pub filled_amount: u64,
        pub cost: u64,
        pub new_vault_balance: u64,
    }

    //1. init_vault_balance

    #[instruction]
    pub fn init_vault_balance(vault_ctxt: Enc<Shared, VaultState>) -> Enc<Mxe, VaultState> {
        let vault = vault_ctxt.to_arcis();
        Mxe::get().from_arcis(VaultState {
            remaining_balance: vault.remaining_balance,
            price_per_token: vault.price_per_token,
        })
    }

    // ── 2. match_slice_v2
    #[instruction]
    pub fn match_slice_v2(
        vault_ctxt: Enc<Mxe, VaultState>,
        request_ctxt: Enc<Shared, BuyRequest>,
    ) -> (u64, u64, Enc<Shared, MatchResult>, Enc<Mxe, VaultState>) {
        let vault = vault_ctxt.to_arcis();
        let req = request_ctxt.to_arcis();

        let price_ok: bool = req.max_price >= vault.price_per_token;
        let available: u64 = if price_ok {
            vault.remaining_balance
        } else {
            0u64
        };
        let fill: u64 = if req.amount_requested < available {
            req.amount_requested
        } else {
            available
        };

        let cost: u64 = ((fill as u128 * vault.price_per_token as u128) / 1_000_000_000u128) as u64;
        let new_balance: u64 = vault.remaining_balance - fill;

        (
            fill.reveal(),
            cost.reveal(),
            request_ctxt.owner.from_arcis(MatchResult {
                filled_amount: fill,
                cost,
                new_vault_balance: new_balance,
            }),
            Mxe::get().from_arcis(VaultState {
                remaining_balance: new_balance,
                price_per_token: vault.price_per_token,
            }),
        )
    }

    // 3. reveal_fill
    #[instruction]
    pub fn reveal_fill(
        result_ctxt: Enc<Mxe, MatchResult>,
        owner_ctxt: Enc<Shared, u64>, // binds owner's x25519 pubkey
    ) -> Enc<Shared, MatchResult> {
        let result = result_ctxt.to_arcis();
        owner_ctxt.owner.from_arcis(result)
    }
}
