use anchor_lang::prelude::*;

pub const POOL_SLOT_COUNT: usize = 4;
pub const POOL_BOOK_CIPHERTEXTS: usize = 8;

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

#[account]
pub struct PoolBook {
    pub authority: Pubkey,
    pub sol_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub wsol_vault: Pubkey,
    pub usdc_vault: Pubkey,
    pub owners: [Pubkey; POOL_SLOT_COUNT],
    pub occupied: [bool; POOL_SLOT_COUNT],
    pub accrued_usdc: [u64; POOL_SLOT_COUNT],
    pub encrypted_book: [[u8; 32]; POOL_BOOK_CIPHERTEXTS],
    pub book_nonce: u128,
    pub is_initialized: bool,
    pub is_matching: bool,
    pub bump: u8,
    pub wsol_vault_bump: u8,
    pub usdc_vault_bump: u8,
}

impl PoolBook {
    pub const LEN: usize = 8
        + 32  // authority
        + 32  // sol_mint
        + 32  // usdc_mint
        + 32  // wsol_vault
        + 32  // usdc_vault
        + (32 * POOL_SLOT_COUNT) // owners
        + POOL_SLOT_COUNT // occupied flags
        + (8 * POOL_SLOT_COUNT) // accrued usdc
        + (32 * POOL_BOOK_CIPHERTEXTS) // encrypted book
        + 16  // nonce
        + 1   // is_initialized
        + 1   // is_matching
        + 1   // bump
        + 1   // wsol vault bump
        + 1; // usdc vault bump
}

#[account]
pub struct PoolDepositTicket {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub slot: u8,
    pub bump: u8,
}

impl PoolDepositTicket {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct PoolCancelTicket {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub slot: u8,
    pub remaining_lamports: u64,
    pub bump: u8,
    pub is_ready: bool,
    pub is_withdrawn: bool,
}

impl PoolCancelTicket {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1;
}

#[account]
pub struct PoolFill {
    pub pool: Pubkey,
    pub buyer: Pubkey,
    pub total_filled_lamports: u64,
    pub total_cost_usdc: u64,
    pub slot_fills: [u64; POOL_SLOT_COUNT],
    pub slot_costs: [u64; POOL_SLOT_COUNT],
    pub is_filled: bool,
    pub is_finalized: bool,
    pub is_settled: bool,
    pub bump: u8,
}

impl PoolFill {
    pub const LEN: usize = 8
        + 32  // pool
        + 32  // buyer
        + 8   // total filled
        + 8   // total cost
        + (8 * POOL_SLOT_COUNT) // slot fills
        + (8 * POOL_SLOT_COUNT) // slot costs
        + 1   // is_filled
        + 1   // is_finalized
        + 1   // is_settled
        + 1; // bump
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
