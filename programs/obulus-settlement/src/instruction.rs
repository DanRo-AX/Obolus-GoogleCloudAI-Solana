use borsh::{BorshDeserialize, BorshSerialize};

use crate::state::InvoiceLineItem;

/// Creates the order PDA and atomically funds its token account from the
/// buyer. `authorization` is normally the buyer or a local Pay.sh agent key;
/// a central session cookie is never sufficient.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, Eq, PartialEq)]
pub struct CreateInvoiceArgs {
    pub invoice_hash: [u8; 32],
    pub query_hash: [u8; 32],
    pub bundle_root: [u8; 32],
    pub authorization: [u8; 32],
    pub dispute_resolver: [u8; 32],
    pub total_amount: u64,
    pub platform_fee: u64,
    pub expires_at: i64,
    /// Time after delivery acknowledgement during which the buyer may open a
    /// dispute. Settlement is permissionless only after this window closes.
    pub dispute_window_seconds: u32,
    pub line_items: Vec<InvoiceLineItem>,
}

/// Program instructions. Status transitions are deliberately small and
/// explicit so a receipt can be reconstructed without trusting the server DB.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, Eq, PartialEq)]
pub enum SettlementInstruction {
    CreateAndFund(CreateInvoiceArgs),
    AcknowledgeDelivery { delivery_root: [u8; 32] },
    Settle,
    Dispute,
    ResolveDispute { refund: bool },
    Refund,
}

impl SettlementInstruction {
    pub fn decode(data: &[u8]) -> Result<Self, std::io::Error> {
        Self::try_from_slice(data)
    }
}
