use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

declare_id!("8N8DZqLjpjmVey83Cy2BNKysBcBYvm9XHxpa7dyRsK9G");

const COMP_DEF_OFFSET_INIT_VAULT: u32 = comp_def_offset("init_vault_balance");
const COMP_DEF_OFFSET_MATCH_SLICE: u32 = comp_def_offset("match_slice_v2");
const COMP_DEF_OFFSET_REVEAL_FILL: u32 = comp_def_offset("reveal_fill");
const COMP_DEF_OFFSET_INIT_POOL_BOOK: u32 = comp_def_offset("init_pool_book");
const COMP_DEF_OFFSET_ADD_POOL_ORDER: u32 = comp_def_offset("add_pool_order");
const COMP_DEF_OFFSET_MATCH_POOL_V2: u32 = comp_def_offset("match_pool_v2");
const COMP_DEF_OFFSET_CANCEL_POOL_ORDER: u32 = comp_def_offset("cancel_pool_order");

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

    pub fn init_pool_book_comp_def(ctx: Context<InitPoolBookCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/init_pool_book.arcis", SUPABASE_BASE),
                hash: circuit_hash!("init_pool_book"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_add_pool_order_comp_def(ctx: Context<InitAddPoolOrderCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/add_pool_order.arcis", SUPABASE_BASE),
                hash: circuit_hash!("add_pool_order"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_match_pool_v2_comp_def(ctx: Context<InitMatchPoolV2CompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/match_pool_v2.arcis", SUPABASE_BASE),
                hash: circuit_hash!("match_pool_v2"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn init_cancel_pool_order_comp_def(ctx: Context<InitCancelPoolOrderCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: format!("{}/cancel_pool_order.arcis", SUPABASE_BASE),
                hash: circuit_hash!("cancel_pool_order"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool_book;
        pool.authority = ctx.accounts.authority.key();
        pool.sol_mint = ctx.accounts.sol_mint.key();
        pool.usdc_mint = ctx.accounts.usdc_mint.key();
        pool.wsol_vault = ctx.accounts.pool_wsol_vault.key();
        pool.usdc_vault = ctx.accounts.pool_usdc_vault.key();
        pool.owners = [Pubkey::default(); POOL_SLOT_COUNT];
        pool.occupied = [false; POOL_SLOT_COUNT];
        pool.accrued_usdc = [0u64; POOL_SLOT_COUNT];
        pool.encrypted_book = [[0u8; 32]; POOL_BOOK_CIPHERTEXTS];
        pool.book_nonce = 0;
        pool.is_initialized = false;
        pool.is_matching = false;
        pool.bump = ctx.bumps.pool_book;
        pool.wsol_vault_bump = ctx.bumps.pool_wsol_vault;
        pool.usdc_vault_bump = ctx.bumps.pool_usdc_vault;
        Ok(())
    }

    pub fn init_pool_book(
        ctx: Context<InitPoolBook>,
        computation_offset: u64,
        book_ciphertexts: [[u8; 32]; POOL_BOOK_CIPHERTEXTS],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        require!(
            !ctx.accounts.pool_book.is_initialized,
            ErrorCode::PoolAlreadyInitialized
        );

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let mut args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce);
        for ciphertext in book_ciphertexts {
            args = args.encrypted_u64(ciphertext);
        }
        let args = args.build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitPoolBookCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.pool_book.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_pool_book")]
    pub fn init_pool_book_callback(
        ctx: Context<InitPoolBookCallback>,
        output: SignedComputationOutputs<InitPoolBookOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitPoolBookOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };
        let pool = &mut ctx.accounts.pool_book;
        pool.encrypted_book
            .copy_from_slice(&o.ciphertexts[..POOL_BOOK_CIPHERTEXTS]);
        pool.book_nonce = o.nonce;
        pool.is_initialized = true;
        Ok(())
    }

    pub fn deposit_pool_order(
        ctx: Context<DepositPoolOrder>,
        computation_offset: u64,
        vault_ct_balance: [u8; 32],
        vault_ct_price: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
        deposit_amount: u64,
        urgency_level: u8,
    ) -> Result<()> {
        require!(
            ctx.accounts.pool_book.is_initialized,
            ErrorCode::PoolNotReady
        );
        require!(!ctx.accounts.pool_book.is_matching, ErrorCode::PoolBusy);

        let slot = ctx
            .accounts
            .pool_book
            .occupied
            .iter()
            .position(|occupied| !*occupied)
            .ok_or(ErrorCode::PoolFull)? as u8;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.pool_wsol_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            deposit_amount,
        )?;

        let ticket = &mut ctx.accounts.deposit_ticket;
        ticket.pool = ctx.accounts.pool_book.key();
        ticket.owner = ctx.accounts.owner.key();
        ticket.slot = slot;
        ticket.bump = ctx.bumps.deposit_ticket;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let mut args = ArgBuilder::new().plaintext_u128(ctx.accounts.pool_book.book_nonce);
        for ciphertext in ctx.accounts.pool_book.encrypted_book {
            args = args.encrypted_u64(ciphertext);
        }
        let args = args
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u64(vault_ct_balance)
            .encrypted_u64(vault_ct_price)
            .plaintext_u8(slot)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![AddPoolOrderCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.pool_book.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.deposit_ticket.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.owner.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        emit!(PoolOrderQueued {
            owner: ctx.accounts.owner.key(),
            slot,
            computation_offset,
            urgency_level,
        });
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "add_pool_order")]
    pub fn add_pool_order_callback(
        ctx: Context<AddPoolOrderCallback>,
        output: SignedComputationOutputs<AddPoolOrderOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(AddPoolOrderOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let pool = &mut ctx.accounts.pool_book;
        let ticket = &ctx.accounts.deposit_ticket;
        let slot = ticket.slot as usize;
        require!(slot < POOL_SLOT_COUNT, ErrorCode::InvalidPoolSlot);
        require!(!pool.occupied[slot], ErrorCode::PoolSlotOccupied);

        pool.encrypted_book
            .copy_from_slice(&o.ciphertexts[..POOL_BOOK_CIPHERTEXTS]);
        pool.book_nonce = o.nonce;
        pool.owners[slot] = ticket.owner;
        pool.occupied[slot] = true;

        emit!(PoolOrderAdded {
            owner: ticket.owner,
            slot: ticket.slot,
        });
        Ok(())
    }

    pub fn secure_pool_buy_request(
        ctx: Context<SecurePoolBuyRequest>,
        computation_offset: u64,
        request_ct_amount: [u8; 32],
        request_ct_price: [u8; 32],
        buyer_pubkey: [u8; 32],
        buyer_nonce: u128,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool_book;
        require!(pool.is_initialized, ErrorCode::PoolNotReady);
        require!(!pool.is_matching, ErrorCode::PoolBusy);
        require!(
            pool.occupied.iter().any(|occupied| *occupied),
            ErrorCode::NoPoolLiquidity
        );

        pool.is_matching = true;

        let fill = &mut ctx.accounts.pool_fill;
        fill.pool = pool.key();
        fill.buyer = ctx.accounts.buyer.key();
        fill.total_filled_lamports = 0;
        fill.total_cost_usdc = 0;
        fill.slot_fills = [0u64; POOL_SLOT_COUNT];
        fill.slot_costs = [0u64; POOL_SLOT_COUNT];
        fill.is_filled = false;
        fill.is_finalized = false;
        fill.is_settled = false;
        fill.bump = ctx.bumps.pool_fill;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let mut args = ArgBuilder::new().plaintext_u128(pool.book_nonce);
        for ciphertext in pool.encrypted_book {
            args = args.encrypted_u64(ciphertext);
        }
        let args = args
            .x25519_pubkey(buyer_pubkey)
            .plaintext_u128(buyer_nonce)
            .encrypted_u64(request_ct_amount)
            .encrypted_u64(request_ct_price)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![MatchPoolV2Callback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.pool_book.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.pool_fill.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;

        emit!(PoolBuyQueued {
            buyer: ctx.accounts.buyer.key(),
            computation_offset,
        });
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "match_pool_v2")]
    pub fn match_pool_v2_callback(
        ctx: Context<MatchPoolV2Callback>,
        output: SignedComputationOutputs<MatchPoolV2Output>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => {
                ctx.accounts.pool_book.is_matching = false;
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        let result = o.field_0;
        let total_filled = result.field_0;
        let total_cost = result.field_1;
        let fill0 = result.field_2;
        let cost0 = result.field_3;
        let fill1 = result.field_4;
        let cost1 = result.field_5;
        let fill2 = result.field_6;
        let cost2 = result.field_7;
        let fill3 = result.field_8;
        let cost3 = result.field_9;
        let buyer_result = &result.field_10;
        let updated_book = &result.field_11;

        let pool = &mut ctx.accounts.pool_book;
        pool.encrypted_book
            .copy_from_slice(&updated_book.ciphertexts[..POOL_BOOK_CIPHERTEXTS]);
        pool.book_nonce = updated_book.nonce;
        pool.is_matching = false;

        let slot_costs = [cost0, cost1, cost2, cost3];

        let fill = &mut ctx.accounts.pool_fill;
        fill.total_filled_lamports = total_filled;
        fill.total_cost_usdc = total_cost;
        fill.slot_fills = [fill0, fill1, fill2, fill3];
        fill.slot_costs = slot_costs;
        fill.is_filled = true;

        emit!(PoolMatchResultEvent {
            pool: pool.key(),
            fill: fill.key(),
            filled_amount_ciphertext: buyer_result.ciphertexts[0],
            cost_ciphertext: buyer_result.ciphertexts[1],
            result_nonce: buyer_result.nonce.to_le_bytes(),
        });
        Ok(())
    }

    pub fn finalize_pool_fill(ctx: Context<FinalizePoolFill>) -> Result<()> {
        let fill = &mut ctx.accounts.pool_fill;
        require!(fill.is_filled, ErrorCode::NotYetFilled);
        require!(!fill.is_finalized, ErrorCode::AlreadyFinalized);
        fill.is_finalized = true;

        emit!(PoolFillFinalized {
            pool: fill.pool,
            fill: fill.key(),
            buyer: fill.buyer,
            filled_lamports: fill.total_filled_lamports,
            cost_usdc: fill.total_cost_usdc,
        });
        Ok(())
    }

    pub fn settle_pool_fill(ctx: Context<SettlePoolFill>) -> Result<()> {
        let fill = &mut ctx.accounts.pool_fill;
        require!(fill.is_finalized, ErrorCode::NotFinalized);
        require!(!fill.is_settled, ErrorCode::AlreadySettled);
        require!(fill.total_filled_lamports > 0, ErrorCode::NothingToSettle);

        let pool_key = ctx.accounts.pool_book.key();
        let seeds = &[
            b"pool_wsol_vault",
            pool_key.as_ref(),
            &[ctx.accounts.pool_book.wsol_vault_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_wsol_vault.to_account_info(),
                    to: ctx.accounts.buyer_wsol_ata.to_account_info(),
                    authority: ctx.accounts.pool_wsol_vault.to_account_info(),
                },
                &[&seeds[..]],
            ),
            fill.total_filled_lamports,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_usdc_ata.to_account_info(),
                    to: ctx.accounts.pool_usdc_vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            fill.total_cost_usdc,
        )?;

        for i in 0..POOL_SLOT_COUNT {
            ctx.accounts.pool_book.accrued_usdc[i] = ctx.accounts.pool_book.accrued_usdc[i]
                .checked_add(fill.slot_costs[i])
                .ok_or(ErrorCode::MathOverflow)?;
        }

        fill.is_settled = true;
        emit!(PoolSettled {
            pool: ctx.accounts.pool_book.key(),
            fill: fill.key(),
            buyer: fill.buyer,
            filled_lamports: fill.total_filled_lamports,
            cost_usdc: fill.total_cost_usdc,
        });
        Ok(())
    }

    pub fn withdraw_pool_seller_credit(
        ctx: Context<WithdrawPoolSellerCredit>,
        slot: u8,
    ) -> Result<()> {
        let slot_idx = slot as usize;
        require!(slot_idx < POOL_SLOT_COUNT, ErrorCode::InvalidPoolSlot);
        require!(
            ctx.accounts.pool_book.owners[slot_idx] == ctx.accounts.owner.key(),
            ErrorCode::UnauthorizedPoolSlot
        );

        let credited = ctx.accounts.pool_book.accrued_usdc[slot_idx];
        require!(credited > 0, ErrorCode::NothingToWithdraw);

        let amount = credited.min(ctx.accounts.pool_usdc_vault.amount);
        require!(amount > 0, ErrorCode::SellerCreditPendingSettlement);
        ctx.accounts.pool_book.accrued_usdc[slot_idx] = 0;

        let pool_key = ctx.accounts.pool_book.key();
        let seeds = &[
            b"pool_usdc_vault",
            pool_key.as_ref(),
            &[ctx.accounts.pool_book.usdc_vault_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_usdc_vault.to_account_info(),
                    to: ctx.accounts.owner_usdc_ata.to_account_info(),
                    authority: ctx.accounts.pool_usdc_vault.to_account_info(),
                },
                &[&seeds[..]],
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn request_cancel_pool_order(
        ctx: Context<RequestCancelPoolOrder>,
        computation_offset: u64,
        slot: u8,
    ) -> Result<()> {
        let slot_idx = slot as usize;
        require!(slot_idx < POOL_SLOT_COUNT, ErrorCode::InvalidPoolSlot);
        require!(
            ctx.accounts.pool_book.is_initialized,
            ErrorCode::PoolNotReady
        );
        require!(!ctx.accounts.pool_book.is_matching, ErrorCode::PoolBusy);
        require!(
            ctx.accounts.pool_book.owners[slot_idx] == ctx.accounts.owner.key(),
            ErrorCode::UnauthorizedPoolSlot
        );
        require!(
            ctx.accounts.pool_book.occupied[slot_idx],
            ErrorCode::PoolSlotEmpty
        );

        let ticket = &mut ctx.accounts.cancel_ticket;
        ticket.pool = ctx.accounts.pool_book.key();
        ticket.owner = ctx.accounts.owner.key();
        ticket.slot = slot;
        ticket.remaining_lamports = 0;
        ticket.bump = ctx.bumps.cancel_ticket;
        ticket.is_ready = false;
        ticket.is_withdrawn = false;

        ctx.accounts.pool_book.is_matching = true;
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut args = ArgBuilder::new().plaintext_u128(ctx.accounts.pool_book.book_nonce);
        for ciphertext in ctx.accounts.pool_book.encrypted_book {
            args = args.encrypted_u64(ciphertext);
        }
        let args = args.plaintext_u8(slot).build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CancelPoolOrderCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[
                    CallbackAccount {
                        pubkey: ctx.accounts.pool_book.key(),
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: ctx.accounts.cancel_ticket.key(),
                        is_writable: true,
                    },
                ],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "cancel_pool_order")]
    pub fn cancel_pool_order_callback(
        ctx: Context<CancelPoolOrderCallback>,
        output: SignedComputationOutputs<CancelPoolOrderOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(o) => o,
            Err(_) => {
                ctx.accounts.pool_book.is_matching = false;
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        let result = o.field_0;
        let remaining_lamports = result.field_0;
        let updated_book = &result.field_1;

        let slot_idx = ctx.accounts.cancel_ticket.slot as usize;
        require!(slot_idx < POOL_SLOT_COUNT, ErrorCode::InvalidPoolSlot);

        let pool = &mut ctx.accounts.pool_book;
        pool.encrypted_book
            .copy_from_slice(&updated_book.ciphertexts[..POOL_BOOK_CIPHERTEXTS]);
        pool.book_nonce = updated_book.nonce;
        pool.occupied[slot_idx] = false;
        pool.owners[slot_idx] = Pubkey::default();
        pool.is_matching = false;

        let ticket = &mut ctx.accounts.cancel_ticket;
        ticket.remaining_lamports = remaining_lamports;
        ticket.is_ready = true;
        Ok(())
    }

    pub fn withdraw_cancelled_pool_order(ctx: Context<WithdrawCancelledPoolOrder>) -> Result<()> {
        require!(
            ctx.accounts.cancel_ticket.is_ready,
            ErrorCode::CancelNotReady
        );
        require!(
            !ctx.accounts.cancel_ticket.is_withdrawn,
            ErrorCode::AlreadyWithdrawn
        );

        let amount = ctx.accounts.cancel_ticket.remaining_lamports;
        require!(amount > 0, ErrorCode::NothingToWithdraw);
        ctx.accounts.cancel_ticket.is_withdrawn = true;

        let pool_key = ctx.accounts.pool_book.key();
        let seeds = &[
            b"pool_wsol_vault",
            pool_key.as_ref(),
            &[ctx.accounts.pool_book.wsol_vault_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_wsol_vault.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.pool_wsol_vault.to_account_info(),
                },
                &[&seeds[..]],
            ),
            amount,
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

#[init_computation_definition_accounts("init_pool_book", payer)]
#[derive(Accounts)]
pub struct InitPoolBookCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POOL_BOOK))]
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

#[init_computation_definition_accounts("add_pool_order", payer)]
#[derive(Accounts)]
pub struct InitAddPoolOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_POOL_ORDER))]
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

#[init_computation_definition_accounts("match_pool_v2", payer)]
#[derive(Accounts)]
pub struct InitMatchPoolV2CompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_POOL_V2))]
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

#[init_computation_definition_accounts("cancel_pool_order", payer)]
#[derive(Accounts)]
pub struct InitCancelPoolOrderCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_comp_def_pda!(COMP_DEF_OFFSET_CANCEL_POOL_ORDER))]
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

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init, payer = authority, space = PoolBook::LEN,
        seeds = [b"pool_book"], bump,
    )]
    pub pool_book: Box<Account<'info, PoolBook>>,
    /// CHECK: mint address stored and checked by token constraints.
    pub sol_mint: AccountInfo<'info>,
    /// CHECK: mint address stored and checked by token constraints.
    pub usdc_mint: AccountInfo<'info>,
    #[account(
        init, payer = authority,
        token::mint = sol_mint, token::authority = pool_wsol_vault,
        seeds = [b"pool_wsol_vault", pool_book.key().as_ref()], bump,
    )]
    pub pool_wsol_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = authority,
        token::mint = usdc_mint, token::authority = pool_usdc_vault,
        seeds = [b"pool_usdc_vault", pool_book.key().as_ref()], bump,
    )]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[queue_computation_accounts("init_pool_book", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitPoolBook<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(
        init_if_needed, space = 9, payer = authority,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POOL_BOOK))]
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

#[callback_accounts("init_pool_book")]
#[derive(Accounts)]
pub struct InitPoolBookCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_POOL_BOOK))]
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
    pub pool_book: Box<Account<'info, PoolBook>>,
}

#[queue_computation_accounts("add_pool_order", owner)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct DepositPoolOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut, address = pool_book.wsol_vault)]
    pub pool_wsol_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub depositor_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = owner, space = PoolDepositTicket::LEN,
        seeds = [b"pool_deposit", owner.key().as_ref(), &computation_offset.to_le_bytes()], bump,
    )]
    pub deposit_ticket: Box<Account<'info, PoolDepositTicket>>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_POOL_ORDER))]
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

#[callback_accounts("add_pool_order")]
#[derive(Accounts)]
pub struct AddPoolOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_ADD_POOL_ORDER))]
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
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut, close = owner)]
    pub deposit_ticket: Box<Account<'info, PoolDepositTicket>>,
    #[account(mut, address = deposit_ticket.owner)]
    /// CHECK: receives closed ticket rent.
    pub owner: AccountInfo<'info>,
}

#[queue_computation_accounts("match_pool_v2", buyer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SecurePoolBuyRequest<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(
        init, payer = buyer, space = PoolFill::LEN,
        seeds = [b"pool_fill", pool_book.key().as_ref(), buyer.key().as_ref(), &computation_offset.to_le_bytes()], bump,
    )]
    pub pool_fill: Box<Account<'info, PoolFill>>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_POOL_V2))]
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

#[callback_accounts("match_pool_v2")]
#[derive(Accounts)]
pub struct MatchPoolV2Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_POOL_V2))]
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
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut)]
    pub pool_fill: Box<Account<'info, PoolFill>>,
}

#[derive(Accounts)]
pub struct FinalizePoolFill<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = buyer,
        constraint = pool_fill.is_filled @ ErrorCode::NotYetFilled,
        constraint = !pool_fill.is_finalized @ ErrorCode::AlreadyFinalized,
    )]
    pub pool_fill: Box<Account<'info, PoolFill>>,
}

#[derive(Accounts)]
pub struct SettlePoolFill<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(
        mut,
        has_one = buyer,
        constraint = pool_fill.pool == pool_book.key(),
        constraint = pool_fill.is_finalized @ ErrorCode::NotFinalized,
        constraint = !pool_fill.is_settled @ ErrorCode::AlreadySettled,
    )]
    pub pool_fill: Box<Account<'info, PoolFill>>,
    #[account(mut, address = pool_book.wsol_vault)]
    pub pool_wsol_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pool_book.usdc_vault)]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = buyer_wsol_ata.owner == buyer.key(),
        constraint = buyer_wsol_ata.mint == pool_book.sol_mint,
    )]
    pub buyer_wsol_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = buyer_usdc_ata.owner == buyer.key(),
        constraint = buyer_usdc_ata.mint == pool_book.usdc_mint,
    )]
    pub buyer_usdc_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawPoolSellerCredit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut, address = pool_book.usdc_vault)]
    pub pool_usdc_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = owner_usdc_ata.owner == owner.key(),
        constraint = owner_usdc_ata.mint == pool_book.usdc_mint,
    )]
    pub owner_usdc_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[queue_computation_accounts("cancel_pool_order", owner)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RequestCancelPoolOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(
        init, payer = owner, space = PoolCancelTicket::LEN,
        seeds = [b"pool_cancel", owner.key().as_ref(), &computation_offset.to_le_bytes()], bump,
    )]
    pub cancel_ticket: Box<Account<'info, PoolCancelTicket>>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CANCEL_POOL_ORDER))]
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

#[callback_accounts("cancel_pool_order")]
#[derive(Accounts)]
pub struct CancelPoolOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CANCEL_POOL_ORDER))]
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
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut)]
    pub cancel_ticket: Box<Account<'info, PoolCancelTicket>>,
}

#[derive(Accounts)]
pub struct WithdrawCancelledPoolOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"pool_book"], bump = pool_book.bump)]
    pub pool_book: Box<Account<'info, PoolBook>>,
    #[account(mut, address = pool_book.wsol_vault)]
    pub pool_wsol_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        has_one = owner,
        constraint = cancel_ticket.pool == pool_book.key(),
        close = owner,
    )]
    pub cancel_ticket: Box<Account<'info, PoolCancelTicket>>,
    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key(),
        constraint = owner_token_account.mint == pool_book.sol_mint,
    )]
    pub owner_token_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
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
#[event]
pub struct PoolOrderQueued {
    pub owner: Pubkey,
    pub slot: u8,
    pub computation_offset: u64,
    pub urgency_level: u8,
}
#[event]
pub struct PoolOrderAdded {
    pub owner: Pubkey,
    pub slot: u8,
}
#[event]
pub struct PoolBuyQueued {
    pub buyer: Pubkey,
    pub computation_offset: u64,
}
#[event]
pub struct PoolMatchResultEvent {
    pub pool: Pubkey,
    pub fill: Pubkey,
    pub filled_amount_ciphertext: [u8; 32],
    pub cost_ciphertext: [u8; 32],
    pub result_nonce: [u8; 16],
}
#[event]
pub struct PoolFillFinalized {
    pub pool: Pubkey,
    pub fill: Pubkey,
    pub buyer: Pubkey,
    pub filled_lamports: u64,
    pub cost_usdc: u64,
}
#[event]
pub struct PoolSettled {
    pub pool: Pubkey,
    pub fill: Pubkey,
    pub buyer: Pubkey,
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
    #[msg("The private pool book is already initialized")]
    PoolAlreadyInitialized,
    #[msg("The private pool is not ready yet")]
    PoolNotReady,
    #[msg("The private pool is busy matching another order")]
    PoolBusy,
    #[msg("The private pool has no open liquidity")]
    NoPoolLiquidity,
    #[msg("The private pool is full")]
    PoolFull,
    #[msg("Invalid private pool slot")]
    InvalidPoolSlot,
    #[msg("This private pool slot is already occupied")]
    PoolSlotOccupied,
    #[msg("This private pool slot is empty")]
    PoolSlotEmpty,
    #[msg("This wallet does not own that private pool slot")]
    UnauthorizedPoolSlot,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("The private cancellation is not ready yet")]
    CancelNotReady,
    #[msg("Seller USDC is still waiting for buyer settlement")]
    SellerCreditPendingSettlement,
}
