use std::collections::BTreeSet;

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::{error::SettlementError, instruction::CreateInvoiceArgs};

pub const INVOICE_SEED: &[u8] = b"obulus-invoice";
pub const INVOICE_MAGIC: [u8; 8] = *b"OBULUS01";
pub const INVOICE_VERSION: u8 = 1;
pub const MAX_LINE_ITEMS: usize = 20;
pub const MAX_PROTOCOL_FEE_BPS: u64 = 1_000;
pub const MIN_DISPUTE_WINDOW_SECONDS: u32 = 60;
pub const MAX_DISPUTE_WINDOW_SECONDS: u32 = 86_400;

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, Eq, PartialEq)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum InvoiceStatus {
    Funded = 1,
    Delivered = 2,
    Settled = 3,
    Disputed = 4,
    RefundApproved = 5,
    Refunded = 6,
}

/// One immutable payout. Recipient is the exact SPL token account, not a
/// mutable profile wallet looked up after the buyer signs.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, Eq, PartialEq)]
pub struct InvoiceLineItem {
    pub recipient_token_account: [u8; 32],
    pub document_hash: [u8; 32],
    pub document_version: u32,
    pub amount: u64,
    /// `0` is a contributor payout and `1` is the protocol fee.
    pub kind: u8,
}

/// On-chain receipt and escrow policy for one evidence purchase.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, Eq, PartialEq)]
pub struct InvoiceAccount {
    pub magic: [u8; 8],
    pub version: u8,
    pub bump: u8,
    pub status: InvoiceStatus,
    pub payer: [u8; 32],
    pub authorization: [u8; 32],
    pub dispute_resolver: [u8; 32],
    pub mint: [u8; 32],
    pub escrow_token_account: [u8; 32],
    pub refund_token_account: [u8; 32],
    pub invoice_hash: [u8; 32],
    pub query_hash: [u8; 32],
    pub bundle_root: [u8; 32],
    pub delivery_root: [u8; 32],
    pub total_amount: u64,
    pub platform_fee: u64,
    pub expires_at: i64,
    pub dispute_window_seconds: u32,
    pub created_at: i64,
    pub delivered_at: i64,
    pub settled_at: i64,
    pub line_items: Vec<InvoiceLineItem>,
}

impl InvoiceAccount {
    pub fn derive_address(
        program_id: &Pubkey,
        payer: &Pubkey,
        invoice_hash: &[u8; 32],
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[INVOICE_SEED, payer.as_ref(), invoice_hash], program_id)
    }

    pub fn serialized_len(args: &CreateInvoiceArgs) -> Result<usize, SettlementError> {
        let placeholder = Self {
            magic: INVOICE_MAGIC,
            version: INVOICE_VERSION,
            bump: 0,
            status: InvoiceStatus::Funded,
            payer: [0; 32],
            authorization: args.authorization,
            dispute_resolver: args.dispute_resolver,
            mint: [0; 32],
            escrow_token_account: [0; 32],
            refund_token_account: [0; 32],
            invoice_hash: args.invoice_hash,
            query_hash: args.query_hash,
            bundle_root: args.bundle_root,
            delivery_root: [0; 32],
            total_amount: args.total_amount,
            platform_fee: args.platform_fee,
            expires_at: args.expires_at,
            dispute_window_seconds: args.dispute_window_seconds,
            created_at: 0,
            delivered_at: 0,
            settled_at: 0,
            line_items: args.line_items.clone(),
        };
        borsh::to_vec(&placeholder)
            .map(|bytes| bytes.len())
            .map_err(|_| SettlementError::InvalidInstruction)
    }

    pub fn validate_args(args: &CreateInvoiceArgs, now: i64) -> Result<(), SettlementError> {
        if is_zero(&args.invoice_hash)
            || is_zero(&args.query_hash)
            || is_zero(&args.bundle_root)
            || is_zero(&args.authorization)
            || is_zero(&args.dispute_resolver)
        {
            return Err(SettlementError::ZeroCommitment);
        }
        if args.dispute_window_seconds < MIN_DISPUTE_WINDOW_SECONDS
            || args.dispute_window_seconds > MAX_DISPUTE_WINDOW_SECONDS
        {
            return Err(SettlementError::InvalidDisputeWindow);
        }
        if args.expires_at <= now.saturating_add(i64::from(args.dispute_window_seconds)) {
            return Err(SettlementError::InvoiceExpired);
        }
        if args.total_amount == 0 || args.line_items.is_empty() {
            return Err(SettlementError::InvalidEconomics);
        }
        if args.line_items.len() > MAX_LINE_ITEMS {
            return Err(SettlementError::InvalidLineItems);
        }
        if args.platform_fee > args.total_amount.saturating_mul(MAX_PROTOCOL_FEE_BPS) / 10_000 {
            return Err(SettlementError::ProtocolFeeTooHigh);
        }

        let mut total = 0_u64;
        let mut platform_total = 0_u64;
        let mut document_identities = BTreeSet::new();
        let mut protocol_fee_items = 0_usize;
        for item in &args.line_items {
            if item.amount == 0
                || item.kind > 1
                || is_zero(&item.recipient_token_account)
                || is_zero(&item.document_hash)
            {
                return Err(SettlementError::InvalidLineItems);
            }
            if !document_identities.insert((item.document_hash, item.document_version, item.kind)) {
                return Err(SettlementError::InvalidLineItems);
            }
            total = total
                .checked_add(item.amount)
                .ok_or(SettlementError::InvalidEconomics)?;
            if item.kind == 1 {
                protocol_fee_items += 1;
                platform_total = platform_total
                    .checked_add(item.amount)
                    .ok_or(SettlementError::InvalidEconomics)?;
            }
        }
        if total != args.total_amount || platform_total != args.platform_fee {
            return Err(SettlementError::InvalidEconomics);
        }
        if (args.platform_fee == 0 && protocol_fee_items != 0)
            || (args.platform_fee > 0 && protocol_fee_items != 1)
        {
            return Err(SettlementError::InvalidLineItems);
        }
        Ok(())
    }
}

pub fn is_zero(value: &[u8; 32]) -> bool {
    value.iter().all(|byte| *byte == 0)
}

pub fn dispute_deadline(
    delivered_at: i64,
    dispute_window_seconds: u32,
) -> Result<i64, SettlementError> {
    delivered_at
        .checked_add(i64::from(dispute_window_seconds))
        .ok_or(SettlementError::InvalidDisputeWindow)
}

pub fn refund_is_allowed(status: InvoiceStatus, expires_at: i64, now: i64) -> bool {
    status == InvoiceStatus::RefundApproved
        || (status == InvoiceStatus::Funded && now >= expires_at)
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    fn hash(value: &str) -> [u8; 32] {
        Sha256::digest(value).into()
    }

    fn args() -> CreateInvoiceArgs {
        CreateInvoiceArgs {
            invoice_hash: hash("invoice"),
            query_hash: hash("query"),
            bundle_root: hash("bundle"),
            authorization: hash("authorization"),
            dispute_resolver: hash("resolver"),
            total_amount: 100,
            platform_fee: 10,
            expires_at: 1_000,
            dispute_window_seconds: 60,
            line_items: vec![
                InvoiceLineItem {
                    recipient_token_account: hash("owner"),
                    document_hash: hash("document"),
                    document_version: 3,
                    amount: 90,
                    kind: 0,
                },
                InvoiceLineItem {
                    recipient_token_account: hash("platform"),
                    document_hash: hash("protocol-fee"),
                    document_version: 1,
                    amount: 10,
                    kind: 1,
                },
            ],
        }
    }

    #[test]
    fn valid_invoice_balances_exactly() {
        assert_eq!(InvoiceAccount::validate_args(&args(), 100), Ok(()));
    }

    #[test]
    fn fee_cap_and_line_item_sum_fail_closed() {
        let mut too_expensive = args();
        too_expensive.platform_fee = 11;
        assert_eq!(
            InvoiceAccount::validate_args(&too_expensive, 100),
            Err(SettlementError::ProtocolFeeTooHigh)
        );

        let mut wrong_sum = args();
        wrong_sum.line_items[0].amount = 89;
        assert_eq!(
            InvoiceAccount::validate_args(&wrong_sum, 100),
            Err(SettlementError::InvalidEconomics)
        );
    }

    #[test]
    fn duplicate_document_payout_is_rejected() {
        let mut duplicate = args();
        duplicate.line_items.push(duplicate.line_items[0].clone());
        duplicate.total_amount = 190;
        assert_eq!(
            InvoiceAccount::validate_args(&duplicate, 100),
            Err(SettlementError::InvalidLineItems)
        );
    }

    #[test]
    fn changing_only_the_recipient_cannot_charge_one_document_twice() {
        let mut duplicate = args();
        let mut second_owner = duplicate.line_items[0].clone();
        second_owner.recipient_token_account = hash("other-owner");
        duplicate.line_items.push(second_owner);
        duplicate.total_amount = 190;
        assert_eq!(
            InvoiceAccount::validate_args(&duplicate, 100),
            Err(SettlementError::InvalidLineItems)
        );
    }

    #[test]
    fn invoice_pda_is_bound_to_payer_and_hash() {
        let program_id = Pubkey::new_from_array(hash("program"));
        let payer = Pubkey::new_from_array(hash("payer"));
        let other = Pubkey::new_from_array(hash("other"));
        let (first, _) = InvoiceAccount::derive_address(&program_id, &payer, &hash("invoice"));
        let (second, _) = InvoiceAccount::derive_address(&program_id, &other, &hash("invoice"));
        assert_ne!(first, second);
    }

    #[test]
    fn invoice_requires_a_bounded_dispute_window_before_delivery_expiry() {
        let mut too_short = args();
        too_short.dispute_window_seconds = MIN_DISPUTE_WINDOW_SECONDS - 1;
        assert_eq!(
            InvoiceAccount::validate_args(&too_short, 100),
            Err(SettlementError::InvalidDisputeWindow)
        );

        let mut expiry_too_close = args();
        expiry_too_close.expires_at = 159;
        assert_eq!(
            InvoiceAccount::validate_args(&expiry_too_close, 100),
            Err(SettlementError::InvoiceExpired)
        );
    }

    #[test]
    fn delivery_cannot_be_turned_into_a_free_expiry_refund() {
        assert!(refund_is_allowed(InvoiceStatus::Funded, 500, 500));
        assert!(refund_is_allowed(InvoiceStatus::RefundApproved, 500, 400));
        assert!(!refund_is_allowed(InvoiceStatus::Delivered, 500, 501));
        assert!(!refund_is_allowed(InvoiceStatus::Disputed, 500, 501));
    }

    #[test]
    fn the_dispute_deadline_is_exact_and_overflow_safe() {
        assert_eq!(dispute_deadline(1_000, 300), Ok(1_300));
        assert_eq!(
            dispute_deadline(i64::MAX, 1),
            Err(SettlementError::InvalidDisputeWindow)
        );
    }
}
