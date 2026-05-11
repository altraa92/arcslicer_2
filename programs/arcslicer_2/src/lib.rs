use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

declare_id!("8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G");

const COMP_DEF_OFFSET_INIT_VAULT: u32 = comp_def_offset("init_vault_balance");
const COMP_DEF_OFFSET_MATCH_SLICE: u32 = comp_def_offset("match_slice_v2");
const COMP_DEF_OFFSET_REVEAL_FILL: u32 = comp_def_offset("reveal_fill");

const SUPABASE_BASE: &str =
    "https://sszoguizxkwwfjihhrpx.supabase.co/storage/v1/object/public/circuits";

pub mod state;
use state::*;

#[arcium_program]
pub mod arcslicer_2 {
    use super::*;

    pub fn init_vault_balance_comp_def(ctx: Context<InitVaultBalanceCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/init_vault_balance.arcis", SUPABASE_BASE),
                hash: circuit_hash!("init_vault_balance"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_match_slice_comp_def(ctx: Context<InitMatchSliceCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/match_slice_v2.arcis", SUPABASE_BASE),
                hash: circuit_hash!("match_slice_v2"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_reveal_fill_comp_def(ctx: Context<InitRevealFillCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/reveal_fill.arcis", SUPABASE_BASE),
                hash: circuit_hash!("reveal_fill"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn deposit_and_init_vault(
        ctx: Context<DepositAndInitVault>,
        computation_offset: u64,
        vault_ct_balance: [u8; 32],
        vault_ct_price: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        deposit_amount: u64,
        urgency_level: u8,
    ) -> Result<()> {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            deposit_amount,
        )?;

        let parent = &mut ctx.accounts.slicer_parent;
        parent.owner = ctx.accounts.owner.key();
        parent.mint = ctx.accounts.mint.key();
        parent.target_mint = ctx.accounts.target_mint.key();
        parent.vault_pda = ctx.accounts.vault_token_account.key();
        parent.total_deposit = deposit_amount;
        parent.remaining_balance = deposit_amount;
        parent.urgency_level = urgency_level;
        parent.last_slice_time = Clock::get()?.unix_timestamp;
        parent.bump = ctx.bumps.slicer_parent;
        parent.vault_bump = ctx.bumps.vault_token_account;
        parent.encrypted_balance = [0u8; 32];
        parent.encrypted_price = [0u8; 32];
        parent.vault_nonce = 0;
        parent.is_withdrawn = false;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(vault_ct_balance)
            .encrypted_u64(vault_ct_price)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitVaultBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.slicer_parent.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        emit!(VaultInitQueued {
            owner: ctx.accounts.owner.key(),
            computation_offset
        });
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_vault_balance")]
    pub fn init_vault_balance_callback(
        ctx: Context<InitVaultBalanceCallback>,
        output: SignedComputationOutputs<InitVaultBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitVaultBalanceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };
        let parent = &mut ctx.accounts.slicer_parent;
        parent.encrypted_balance = o.ciphertexts[0];
        parent.encrypted_price = o.ciphertexts[1];
        parent.vault_nonce = o.nonce;
        emit!(VaultInitialised {
            owner: parent.owner
        });
        Ok(())
    }

    pub fn secure_buy_request(
        ctx: Context<SecureBuyRequest>,
        computation_offset: u64,
        request_ct_amount: [u8; 32],
        request_ct_price: [u8; 32],
        buyer_pubkey: [u8; 32],
        buyer_nonce: u128,
    ) -> Result<()> {
        let parent = &ctx.accounts.slicer_parent;
        let child = &mut ctx.accounts.child_slice;
        child.parent = parent.key();
        child.buyer = ctx.accounts.buyer.key();
        child.amount_available = 0;
        child.price_per_token = 0;
        child.is_filled = false;
        child.bump = ctx.bumps.child_slice;
        child.filled_lamports = 0;
        child.cost_usdc = 0;
        child.is_finalized = false;
        child.is_settled = false;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .plaintext_u128(parent.vault_nonce)
            .encrypted_u64(parent.encrypted_balance)
            .encrypted_u64(parent.encrypted_price)
            .x25519_pubkey(buyer_pubkey)
            .plaintext_u128(buyer_nonce)
            .encrypted_u64(request_ct_amount)
            .encrypted_u64(request_ct_price)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![MatchSliceV2Callback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.slicer_parent.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.child_slice.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        emit!(BuyRequestQueued {
            buyer: ctx.accounts.buyer.key(),
            parent: parent.key(),
            computation_offset,
        });
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "match_slice_v2")]
    pub fn match_slice_v2_callback(
        ctx: Context<MatchSliceV2Callback>,
        output: SignedComputationOutputs<MatchSliceV2Output>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let filled_lamports = o.field_0.field_0;
        let cost_usdc = o.field_0.field_1;
        let result_output = &o.field_0.field_2;
        let vault_output = &o.field_0.field_3;

        let parent = &mut ctx.accounts.slicer_parent;
        require!(
            filled_lamports <= parent.remaining_balance,
            ErrorCode::FillExceedsBalance
        );
        parent.encrypted_balance = vault_output.ciphertexts[0];
        parent.encrypted_price = vault_output.ciphertexts[1];
        parent.vault_nonce = vault_output.nonce;
        parent.remaining_balance = parent
            .remaining_balance
            .checked_sub(filled_lamports)
            .ok_or(ErrorCode::FillExceedsBalance)?;

        ctx.accounts.child_slice.is_filled = true;
        ctx.accounts.child_slice.filled_lamports = filled_lamports;
        ctx.accounts.child_slice.cost_usdc = cost_usdc;

        emit!(MatchResultEvent {
            parent: parent.key(),
            child: ctx.accounts.child_slice.key(),
            filled_amount_ciphertext: result_output.ciphertexts[0],
            cost_ciphertext: result_output.ciphertexts[1],
            new_balance_ciphertext: result_output.ciphertexts[2],
            result_nonce: result_output.nonce.to_le_bytes(),
        });
        Ok(())
    }

    pub fn finalize_fill(ctx: Context<FinalizeFill>) -> Result<()> {
        let child = &mut ctx.accounts.child_slice;
        require!(child.is_filled, ErrorCode::NotYetFilled);
        require!(!child.is_finalized, ErrorCode::AlreadyFinalized);
        child.is_finalized = true;

        emit!(FillFinalized {
            parent: ctx.accounts.slicer_parent.key(),
            child: child.key(),
            filled_lamports: child.filled_lamports,
            cost_usdc: child.cost_usdc,
            remaining_balance: ctx.accounts.slicer_parent.remaining_balance,
        });
        Ok(())
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let child = &ctx.accounts.child_slice;
        require!(child.is_finalized, ErrorCode::NotFinalized);
        require!(!child.is_settled, ErrorCode::AlreadySettled);
        require!(child.filled_lamports > 0, ErrorCode::NothingToSettle);

        let filled_lamports = child.filled_lamports;
        let cost_usdc = child.cost_usdc;

        let parent = &ctx.accounts.slicer_parent;
        let owner_key = parent.owner;
        let mint_key = parent.mint;
        let vault_bump = parent.vault_bump;

        let seeds = &[
            b"vault",
            owner_key.as_ref(),
            mint_key.as_ref(),
            &[vault_bump],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.buyer_wsol_ata.to_account_info(),
                    authority: ctx.accounts.vault_token_account.to_account_info(),
                },
                &[&seeds[..]],
            ),
            filled_lamports,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc_ata.to_account_info(),
                    to: ctx.accounts.seller_usdc_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            cost_usdc,
        )?;

        ctx.accounts.child_slice.is_settled = true;

        emit!(Settled {
            parent: parent.key(),
            child: ctx.accounts.child_slice.key(),
            buyer: ctx.accounts.buyer.key(),
            seller: owner_key,
            filled_lamports,
            cost_usdc,
        });

        Ok(())
    }

    pub fn withdraw_remainder(ctx: Context<WithdrawRemainder>) -> Result<()> {
        let parent = &mut ctx.accounts.slicer_parent;
        require!(!parent.is_withdrawn, ErrorCode::AlreadyWithdrawn);
        require!(parent.remaining_balance > 0, ErrorCode::NothingToWithdraw);

        let amount = parent.remaining_balance;
        let seeds = &[
            b"vault",
            parent.owner.as_ref(),
            parent.mint.as_ref(),
            &[parent.vault_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.vault_token_account.to_account_info(),
                },
                &[&seeds[..]],
            ),
            amount,
        )?;

        parent.remaining_balance = 0;
        parent.is_withdrawn = true;
        Ok(())
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let parent = &ctx.accounts.slicer_parent;
        require!(
            parent.is_withdrawn || parent.remaining_balance == 0,
            ErrorCode::VaultStillActive
        );
        require!(
            ctx.accounts.vault_token_account.amount == 0,
            ErrorCode::VaultStillFunded
        );
        Ok(())
    }
}

#[init_computation_definition_accounts("init_vault_balance", payer)]
#[derive(Accounts)]
pub struct InitVaultBalanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VAULT))]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: checked by the Arcium program.
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[init_computation_definition_accounts("match_slice_v2", payer)]
#[derive(Accounts)]
pub struct InitMatchSliceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_SLICE))]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: checked by the Arcium program.
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[init_computation_definition_accounts("reveal_fill", payer)]
#[derive(Accounts)]
pub struct InitRevealFillCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_FILL))]
    /// CHECK: initialized and checked by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: checked by the Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: checked by the Arcium program.
    pub lut_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[queue_computation_accounts("init_vault_balance", owner)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DepositAndInitVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init, payer = owner, space = SlicerParent::LEN,
        seeds = [b"slicer_parent", owner.key().as_ref(), mint.key().as_ref()], bump,
    )]
    pub slicer_parent: Box<Account<'info, SlicerParent>>,
    /// CHECK: used only for PDA seed
    pub mint: AccountInfo<'info>,
    /// CHECK: used only for PDA seed
    pub target_mint: AccountInfo<'info>,
    #[account(mut)]
    pub depositor_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = owner,
        token::mint = mint, token::authority = vault_token_account,
        seeds = [b"vault", owner.key().as_ref(), mint.key().as_ref()], bump,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, space = 9, payer = owner,
        seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VAULT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_vault_balance")]
#[derive(Accounts)]
pub struct InitVaultBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_VAULT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub slicer_parent: Box<Account<'info, SlicerParent>>,
}

#[queue_computation_accounts("match_slice_v2", buyer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SecureBuyRequest<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"slicer_parent", slicer_parent.owner.as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.bump,
    )]
    pub slicer_parent: Account<'info, SlicerParent>,
    #[account(
        init, payer = buyer, space = ChildSlice::LEN,
        seeds = [b"child_slice", slicer_parent.key().as_ref(), buyer.key().as_ref(), &computation_offset.to_le_bytes()],
        bump,
    )]
    pub child_slice: Box<Account<'info, ChildSlice>>,
    #[account(
        init_if_needed, space = 9, payer = buyer,
        seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_SLICE))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("match_slice_v2")]
#[derive(Accounts)]
pub struct MatchSliceV2Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_SLICE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub slicer_parent: Account<'info, SlicerParent>,
    #[account(mut)]
    pub child_slice: Account<'info, ChildSlice>,
}

#[derive(Accounts)]
pub struct FinalizeFill<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = buyer,
        constraint = child_slice.is_filled     @ ErrorCode::NotYetFilled,
        constraint = !child_slice.is_finalized @ ErrorCode::AlreadyFinalized,
    )]
    pub child_slice: Account<'info, ChildSlice>,
    #[account(
        mut,
        constraint = child_slice.parent == slicer_parent.key(),
    )]
    pub slicer_parent: Account<'info, SlicerParent>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        has_one = buyer,
        constraint = child_slice.is_finalized  @ ErrorCode::NotFinalized,
        constraint = !child_slice.is_settled   @ ErrorCode::AlreadySettled,
        constraint = child_slice.filled_lamports > 0 @ ErrorCode::NothingToSettle,
    )]
    pub child_slice: Account<'info, ChildSlice>,

    #[account(
        mut,
        constraint = child_slice.parent == slicer_parent.key(),
    )]
    pub slicer_parent: Account<'info, SlicerParent>,

    #[account(
        mut,
        seeds = [b"vault", slicer_parent.owner.as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.vault_bump,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = buyer_wsol_ata.owner == buyer.key(),
        constraint = buyer_wsol_ata.mint  == slicer_parent.mint,
    )]
    pub buyer_wsol_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = buyer_usdc_ata.owner == buyer.key(),
        constraint = buyer_usdc_ata.mint  == slicer_parent.target_mint,
    )]
    pub buyer_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = seller_usdc_ata.owner == slicer_parent.owner,
        constraint = seller_usdc_ata.mint  == slicer_parent.target_mint,
    )]
    pub seller_usdc_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawRemainder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut, has_one = owner, close = owner,
        seeds = [b"slicer_parent", owner.key().as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.bump,
    )]
    pub slicer_parent: Account<'info, SlicerParent>,
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.vault_bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut, has_one = owner, close = owner,
        seeds = [b"slicer_parent", owner.key().as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.bump,
    )]
    pub slicer_parent: Account<'info, SlicerParent>,
    #[account(
        seeds = [b"vault", owner.key().as_ref(), slicer_parent.mint.as_ref()],
        bump = slicer_parent.vault_bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
}

#[event]
pub struct VaultInitQueued {
    pub owner: Pubkey,
    pub computation_offset: u64,
}
#[event]
pub struct VaultInitialised {
    pub owner: Pubkey,
}
#[event]
pub struct BuyRequestQueued {
    pub buyer: Pubkey,
    pub parent: Pubkey,
    pub computation_offset: u64,
}
#[event]
pub struct MatchResultEvent {
    pub parent: Pubkey,
    pub child: Pubkey,
    pub filled_amount_ciphertext: [u8; 32],
    pub cost_ciphertext: [u8; 32],
    pub new_balance_ciphertext: [u8; 32],
    pub result_nonce: [u8; 16],
}
#[event]
pub struct FillFinalized {
    pub parent: Pubkey,
    pub child: Pubkey,
    pub filled_lamports: u64,
    pub cost_usdc: u64,
    pub remaining_balance: u64,
}
#[event]
pub struct Settled {
    pub parent: Pubkey,
    pub child: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub filled_lamports: u64,
    pub cost_usdc: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The private matching cluster is not ready yet")]
    ClusterNotSet,
    #[msg("The private match did not complete")]
    AbortedComputation,
    #[msg("Nothing left to withdraw")]
    NothingToWithdraw,
    #[msg("Already withdrawn")]
    AlreadyWithdrawn,
    #[msg("The match result is not ready yet")]
    NotYetFilled,
    #[msg("This fill was already finalized")]
    AlreadyFinalized,
    #[msg("Fill amount exceeds vault remaining balance")]
    FillExceedsBalance,
    #[msg("Finalize this fill before settling it")]
    NotFinalized,
    #[msg("This order is already settled")]
    AlreadySettled,
    #[msg("Nothing to settle for this order")]
    NothingToSettle,
    #[msg("Vault still has an active remaining balance")]
    VaultStillActive,
    #[msg("Vault token account still holds funds")]
    VaultStillFunded,
}