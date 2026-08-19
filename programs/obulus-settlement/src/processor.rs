use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::program_pack::Pack;
use solana_program::{
    account_info::{AccountInfo, next_account_info},
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::{instruction as system_instruction, program as system_program};
use spl_token::state::{Account as TokenAccount, Mint};

use crate::{
    error::SettlementError,
    instruction::{CreateInvoiceArgs, SettlementInstruction},
    state::{
        INVOICE_MAGIC, INVOICE_SEED, INVOICE_VERSION, InvoiceAccount, InvoiceStatus,
        dispute_deadline, is_zero, refund_is_allowed,
    },
};

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = SettlementInstruction::decode(instruction_data)
        .map_err(|_| SettlementError::InvalidInstruction)?;
    match instruction {
        SettlementInstruction::CreateAndFund(args) => create_and_fund(program_id, accounts, args),
        SettlementInstruction::AcknowledgeDelivery { delivery_root } => {
            acknowledge_delivery(program_id, accounts, delivery_root)
        }
        SettlementInstruction::Settle => settle(program_id, accounts),
        SettlementInstruction::Dispute => dispute(program_id, accounts),
        SettlementInstruction::ResolveDispute { refund } => {
            resolve_dispute(program_id, accounts, refund)
        }
        SettlementInstruction::Refund => refund(program_id, accounts),
    }
}

fn create_and_fund(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: CreateInvoiceArgs,
) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let payer = next_account_info(iterator)?;
    let invoice = next_account_info(iterator)?;
    let payer_token = next_account_info(iterator)?;
    let escrow_token = next_account_info(iterator)?;
    let refund_token = next_account_info(iterator)?;
    let mint = next_account_info(iterator)?;
    let token_program = next_account_info(iterator)?;
    let system_program = next_account_info(iterator)?;

    require_signer(payer)?;
    if token_program.key != &spl_token::id() || system_program.key != &system_program::ID {
        return Err(SettlementError::InvalidAccount.into());
    }
    let now = Clock::get()?.unix_timestamp;
    InvoiceAccount::validate_args(&args, now)?;
    let (expected_invoice, bump) =
        InvoiceAccount::derive_address(program_id, payer.key, &args.invoice_hash);
    if invoice.key != &expected_invoice
        || !invoice.data_is_empty()
        || invoice.owner != &system_program::ID
    {
        return Err(SettlementError::InvalidInvoicePda.into());
    }

    let mint_state = unpack_mint(mint, token_program.key)?;
    let payer_token_state = unpack_token(payer_token, token_program.key)?;
    let escrow_token_state = unpack_token(escrow_token, token_program.key)?;
    let refund_token_state = unpack_token(refund_token, token_program.key)?;
    if payer_token_state.owner != *payer.key
        || payer_token_state.mint != *mint.key
        || escrow_token_state.owner != *invoice.key
        || escrow_token_state.mint != *mint.key
        || refund_token_state.owner != *payer.key
        || refund_token_state.mint != *mint.key
    {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    let recipient_accounts = iterator.collect::<Vec<_>>();
    if recipient_accounts.len() != args.line_items.len() {
        return Err(SettlementError::InvalidAccount.into());
    }
    for (item, recipient) in args.line_items.iter().zip(&recipient_accounts) {
        if recipient.key.to_bytes() != item.recipient_token_account {
            return Err(SettlementError::InvalidTokenAccount.into());
        }
        let recipient_state = unpack_token(recipient, token_program.key)?;
        if recipient_state.mint != *mint.key {
            return Err(SettlementError::InvalidTokenAccount.into());
        }
    }

    let state = InvoiceAccount {
        magic: INVOICE_MAGIC,
        version: INVOICE_VERSION,
        bump,
        status: InvoiceStatus::Funded,
        payer: payer.key.to_bytes(),
        authorization: args.authorization,
        dispute_resolver: args.dispute_resolver,
        mint: mint.key.to_bytes(),
        escrow_token_account: escrow_token.key.to_bytes(),
        refund_token_account: refund_token.key.to_bytes(),
        invoice_hash: args.invoice_hash,
        query_hash: args.query_hash,
        bundle_root: args.bundle_root,
        delivery_root: [0; 32],
        total_amount: args.total_amount,
        platform_fee: args.platform_fee,
        expires_at: args.expires_at,
        dispute_window_seconds: args.dispute_window_seconds,
        created_at: now,
        delivered_at: 0,
        settled_at: 0,
        line_items: args.line_items,
    };
    let serialized = borsh::to_vec(&state).map_err(|_| SettlementError::InvalidInstruction)?;
    let rent = Rent::get()?;
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[
        INVOICE_SEED,
        payer.key.as_ref(),
        &state.invoice_hash,
        &bump_seed,
    ];
    let minimum_balance = rent.minimum_balance(serialized.len());
    let rent_deficit = minimum_balance.saturating_sub(invoice.lamports());
    if rent_deficit > 0 {
        invoke(
            &system_instruction::transfer(payer.key, invoice.key, rent_deficit),
            &[payer.clone(), invoice.clone(), system_program.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(invoice.key, serialized.len() as u64),
        &[invoice.clone(), system_program.clone()],
        &[signer_seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(invoice.key, program_id),
        &[invoice.clone(), system_program.clone()],
        &[signer_seeds],
    )?;

    let transfer = spl_token::instruction::transfer_checked(
        token_program.key,
        payer_token.key,
        mint.key,
        escrow_token.key,
        payer.key,
        &[],
        state.total_amount,
        mint_state.decimals,
    )?;
    invoke(
        &transfer,
        &[
            payer_token.clone(),
            mint.clone(),
            escrow_token.clone(),
            payer.clone(),
            token_program.clone(),
        ],
    )?;
    state
        .serialize(&mut &mut invoice.data.borrow_mut()[..])
        .map_err(|_| SettlementError::AccountTooSmall.into())
}

fn acknowledge_delivery(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    delivery_root: [u8; 32],
) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let authorization = next_account_info(iterator)?;
    let invoice = next_account_info(iterator)?;
    require_signer(authorization)?;
    if is_zero(&delivery_root) {
        return Err(SettlementError::ZeroCommitment.into());
    }
    let mut state = load_invoice(invoice, program_id)?;
    require_invoice_pda(invoice, program_id, &state)?;
    if authorization.key.to_bytes() != state.authorization {
        return Err(SettlementError::Unauthorized.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now >= state.expires_at {
        return Err(SettlementError::InvoiceExpired.into());
    }
    if state.status != InvoiceStatus::Funded {
        return Err(SettlementError::InvalidState.into());
    }
    state.status = InvoiceStatus::Delivered;
    state.delivery_root = delivery_root;
    state.delivered_at = now;
    save_invoice(invoice, &state)
}

fn settle(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let invoice = next_account_info(iterator)?;
    let escrow_token = next_account_info(iterator)?;
    let mint = next_account_info(iterator)?;
    let token_program = next_account_info(iterator)?;
    if token_program.key != &spl_token::id() {
        return Err(SettlementError::InvalidAccount.into());
    }
    let mut state = load_invoice(invoice, program_id)?;
    require_invoice_pda(invoice, program_id, &state)?;
    if state.status != InvoiceStatus::Delivered || is_zero(&state.delivery_root) {
        return Err(SettlementError::InvalidState.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now < dispute_deadline(state.delivered_at, state.dispute_window_seconds)? {
        return Err(SettlementError::DisputeWindowState.into());
    }
    if escrow_token.key.to_bytes() != state.escrow_token_account
        || mint.key.to_bytes() != state.mint
    {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    let mint_state = unpack_mint(mint, token_program.key)?;
    let escrow_state = unpack_token(escrow_token, token_program.key)?;
    if escrow_state.owner != *invoice.key
        || escrow_state.mint != *mint.key
        || escrow_state.amount < state.total_amount
    {
        return Err(SettlementError::InvalidTokenAccount.into());
    }

    let recipient_accounts = iterator.collect::<Vec<_>>();
    if recipient_accounts.len() != state.line_items.len() {
        return Err(SettlementError::InvalidAccount.into());
    }
    let payer = Pubkey::new_from_array(state.payer);
    let bump_seed = [state.bump];
    let signer_seeds: &[&[u8]] = &[
        INVOICE_SEED,
        payer.as_ref(),
        &state.invoice_hash,
        &bump_seed,
    ];
    for (item, recipient) in state.line_items.iter().zip(recipient_accounts) {
        if recipient.key.to_bytes() != item.recipient_token_account {
            return Err(SettlementError::InvalidTokenAccount.into());
        }
        let recipient_state = unpack_token(recipient, token_program.key)?;
        if recipient_state.mint != *mint.key {
            return Err(SettlementError::InvalidTokenAccount.into());
        }
        let transfer = spl_token::instruction::transfer_checked(
            token_program.key,
            escrow_token.key,
            mint.key,
            recipient.key,
            invoice.key,
            &[],
            item.amount,
            mint_state.decimals,
        )?;
        invoke_signed(
            &transfer,
            &[
                escrow_token.clone(),
                mint.clone(),
                (*recipient).clone(),
                invoice.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )?;
    }
    state.status = InvoiceStatus::Settled;
    state.settled_at = now;
    save_invoice(invoice, &state)
}

fn dispute(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let payer = next_account_info(iterator)?;
    let invoice = next_account_info(iterator)?;
    require_signer(payer)?;
    let mut state = load_invoice(invoice, program_id)?;
    require_invoice_pda(invoice, program_id, &state)?;
    if payer.key.to_bytes() != state.payer {
        return Err(SettlementError::Unauthorized.into());
    }
    if state.status != InvoiceStatus::Delivered {
        return Err(SettlementError::InvalidState.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now >= dispute_deadline(state.delivered_at, state.dispute_window_seconds)? {
        return Err(SettlementError::DisputeWindowState.into());
    }
    state.status = InvoiceStatus::Disputed;
    save_invoice(invoice, &state)
}

fn resolve_dispute(program_id: &Pubkey, accounts: &[AccountInfo], refund: bool) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let resolver = next_account_info(iterator)?;
    let invoice = next_account_info(iterator)?;
    require_signer(resolver)?;
    let mut state = load_invoice(invoice, program_id)?;
    require_invoice_pda(invoice, program_id, &state)?;
    if resolver.key.to_bytes() != state.dispute_resolver {
        return Err(SettlementError::Unauthorized.into());
    }
    if state.status != InvoiceStatus::Disputed {
        return Err(SettlementError::InvalidState.into());
    }
    if refund {
        state.status = InvoiceStatus::RefundApproved;
    } else {
        state.status = InvoiceStatus::Delivered;
    }
    save_invoice(invoice, &state)
}

fn refund(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iterator = &mut accounts.iter();
    let _caller = next_account_info(iterator)?;
    let invoice = next_account_info(iterator)?;
    let escrow_token = next_account_info(iterator)?;
    let refund_token = next_account_info(iterator)?;
    let mint = next_account_info(iterator)?;
    let token_program = next_account_info(iterator)?;
    if token_program.key != &spl_token::id() {
        return Err(SettlementError::InvalidAccount.into());
    }
    let mut state = load_invoice(invoice, program_id)?;
    require_invoice_pda(invoice, program_id, &state)?;
    let now = Clock::get()?.unix_timestamp;
    if state.status == InvoiceStatus::Settled || state.status == InvoiceStatus::Refunded {
        return Err(SettlementError::InvalidState.into());
    }
    if !refund_is_allowed(state.status, state.expires_at, now) {
        return Err(SettlementError::Unauthorized.into());
    }
    if escrow_token.key.to_bytes() != state.escrow_token_account
        || refund_token.key.to_bytes() != state.refund_token_account
        || mint.key.to_bytes() != state.mint
    {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    let mint_state = unpack_mint(mint, token_program.key)?;
    let escrow_state = unpack_token(escrow_token, token_program.key)?;
    let refund_state = unpack_token(refund_token, token_program.key)?;
    if escrow_state.owner != *invoice.key
        || escrow_state.mint != *mint.key
        || refund_state.mint != *mint.key
    {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    let payer = Pubkey::new_from_array(state.payer);
    let bump_seed = [state.bump];
    let signer_seeds: &[&[u8]] = &[
        INVOICE_SEED,
        payer.as_ref(),
        &state.invoice_hash,
        &bump_seed,
    ];
    if escrow_state.amount > 0 {
        let transfer = spl_token::instruction::transfer_checked(
            token_program.key,
            escrow_token.key,
            mint.key,
            refund_token.key,
            invoice.key,
            &[],
            escrow_state.amount,
            mint_state.decimals,
        )?;
        invoke_signed(
            &transfer,
            &[
                escrow_token.clone(),
                mint.clone(),
                refund_token.clone(),
                invoice.clone(),
                token_program.clone(),
            ],
            &[signer_seeds],
        )?;
    }
    state.status = InvoiceStatus::Refunded;
    save_invoice(invoice, &state)
}

fn load_invoice(
    account: &AccountInfo,
    program_id: &Pubkey,
) -> Result<InvoiceAccount, ProgramError> {
    if account.owner != program_id {
        return Err(SettlementError::InvalidAccount.into());
    }
    let state = InvoiceAccount::try_from_slice(&account.data.borrow())
        .map_err(|_| SettlementError::InvalidAccount)?;
    if state.magic != INVOICE_MAGIC || state.version != INVOICE_VERSION {
        return Err(SettlementError::InvalidAccount.into());
    }
    Ok(state)
}

fn save_invoice(account: &AccountInfo, state: &InvoiceAccount) -> ProgramResult {
    state
        .serialize(&mut &mut account.data.borrow_mut()[..])
        .map_err(|_| SettlementError::AccountTooSmall.into())
}

fn require_invoice_pda(
    invoice: &AccountInfo,
    program_id: &Pubkey,
    state: &InvoiceAccount,
) -> ProgramResult {
    let payer = Pubkey::new_from_array(state.payer);
    let (expected, bump) = InvoiceAccount::derive_address(program_id, &payer, &state.invoice_hash);
    if invoice.key != &expected || state.bump != bump {
        return Err(SettlementError::InvalidInvoicePda.into());
    }
    Ok(())
}

fn require_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        return Err(SettlementError::Unauthorized.into());
    }
    Ok(())
}

fn unpack_token(
    account: &AccountInfo,
    token_program: &Pubkey,
) -> Result<TokenAccount, ProgramError> {
    if account.owner != token_program {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    TokenAccount::unpack(&account.data.borrow())
        .map_err(|_| SettlementError::InvalidTokenAccount.into())
}

fn unpack_mint(account: &AccountInfo, token_program: &Pubkey) -> Result<Mint, ProgramError> {
    if account.owner != token_program {
        return Err(SettlementError::InvalidTokenAccount.into());
    }
    Mint::unpack(&account.data.borrow()).map_err(|_| SettlementError::InvalidTokenAccount.into())
}
