use anchor_lang::InstructionData;

#[test]
fn generated_instruction_builders_compile() {
    let _ = arcslicer_2::instruction::InitVaultBalanceCompDef {}.data();
    let _ = arcslicer_2::instruction::InitMatchSliceCompDef {}.data();
    let _ = arcslicer_2::instruction::InitRevealFillCompDef {}.data();

    let _ = arcslicer_2::instruction::DepositAndInitVault {
        computation_offset: 0,
        vault_ct_balance: [0; 32],
        vault_ct_price: [0; 32],
        pubkey: [0; 32],
        nonce: 0,
        deposit_amount: 0,
        urgency_level: 1,
    }
    .data();

    let _ = arcslicer_2::instruction::SecureBuyRequest {
        computation_offset: 0,
        request_ct_amount: [0; 32],
        request_ct_price: [0; 32],
        buyer_pubkey: [0; 32],
        buyer_nonce: 0,
    }
    .data();

    let _ = arcslicer_2::instruction::WithdrawRemainder {}.data();
}
