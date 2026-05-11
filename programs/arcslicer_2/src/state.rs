use anchor_lang::prelude::*;

#[account]
pub struct SlicerParent {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub target_mint: Pubkey,
    pub vault_pda: Pubkey,
    pub total_deposit: u64,
    pub remaining_balance: u64,
    pub urgency_level: u8,
    pub last_slice_time: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub encrypted_balance: [u8; 32],
    pub encrypted_price: [u8; 32],
    pub vault_nonce: u128,
    pub is_withdrawn: bool,
}

impl SlicerParent {
    pub const LEN: usize = 8
        + 32  // owner
        + 32  // mint
        + 32  // target_mint
        + 32  // vault_pda
        + 8   // total_deposit
        + 8   // remaining_balance
        + 1   // urgency_level
        + 8   // last_slice_time
        + 1   // bump
        + 1   // vault_bump
        + 32  // encrypted_balance
        + 32  // encrypted_price
        + 16  // vault_nonce
        + 1; // is_withdrawn
}

#[account]
pub struct ChildSlice {
    pub parent: Pubkey,
    pub buyer: Pubkey,
    pub amount_available: u64,
    pub price_per_token: u64,
    pub is_filled: bool,
    pub bump: u8,
    pub filled_lamports: u64,
    pub cost_usdc: u64,
    pub is_finalized: bool,
    pub is_settled: bool,
}

impl ChildSlice {
    pub const LEN: usize = 8
        + 32  // parent
        + 32  // buyer
        + 8   // amount_available
        + 8   // price_per_token
        + 1   // is_filled
        + 1   // bump
        + 8   // filled_lamports
        + 8   // cost_usdc
        + 1   // is_finalized
        + 1; // is_settled
}
