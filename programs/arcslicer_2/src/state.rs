// programs/arcslicer_2/src/state.rs

use anchor_lang::prelude::*;

#[account]
pub struct SlicerParent {
    pub owner: Pubkey,           // The Whale who deposits funds
    pub mint: Pubkey,            // The token being sold
    pub target_mint: Pubkey,     // The token wanted in return
    pub vault_pda: Pubkey,       // The escrow token account
    pub total_deposit: u64,      // Original amount deposited
    pub remaining_balance: u64,  // Public mirror — synced on reveal
    pub urgency_level: u8,       // 1 Stealth | 2 Standard | 3 Aggressive
    pub last_slice_time: i64,    // Timestamp of last engine trigger
    pub bump: u8,                // PDA bump for this account
    pub vault_bump: u8,          // PDA bump for the token vault

    // Arcium MXE-encrypted vault state (only the MPC cluster can read these)
    pub encrypted_balance: [u8; 32], // Enc<Mxe, remaining_balance>
    pub encrypted_price:   [u8; 32], // Enc<Mxe, price_per_token>
    pub vault_nonce: u128,           // Nonce from last Arcium computation

    pub is_withdrawn: bool,
}

impl SlicerParent {
    pub const LEN: usize = 8   // discriminator
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
        + 1;  // is_withdrawn
}

#[account]
pub struct ChildSlice {
    pub parent: Pubkey,        // Links back to SlicerParent
    pub buyer: Pubkey,         // The buyer who submitted the order
    pub amount_available: u64, // Filled by MPC callback
    pub price_per_token: u64,  // Filled by MPC callback
    pub is_filled: bool,       // True once callback runs
    pub bump: u8,
}

impl ChildSlice {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1;
}