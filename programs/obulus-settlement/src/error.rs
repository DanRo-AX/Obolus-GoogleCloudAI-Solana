use solana_program::program_error::ProgramError;
use thiserror::Error;

/// Stable custom errors surfaced to clients and the public invoice verifier.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[repr(u32)]
pub enum SettlementError {
    #[error("instruction data is invalid")]
    InvalidInstruction = 0,
    #[error("account order or ownership is invalid")]
    InvalidAccount = 1,
    #[error("invoice PDA does not match payer and invoice hash")]
    InvalidInvoicePda = 2,
    #[error("invoice economics do not balance")]
    InvalidEconomics = 3,
    #[error("protocol fee exceeds the signed maximum")]
    ProtocolFeeTooHigh = 4,
    #[error("invoice has expired")]
    InvoiceExpired = 5,
    #[error("invoice state transition is invalid")]
    InvalidState = 6,
    #[error("required signer is missing or unauthorized")]
    Unauthorized = 7,
    #[error("token mint or token-account authority is invalid")]
    InvalidTokenAccount = 8,
    #[error("delivery or invoice hash cannot be zero")]
    ZeroCommitment = 9,
    #[error("invoice contains duplicate or malformed line items")]
    InvalidLineItems = 10,
    #[error("serialized invoice account is too small")]
    AccountTooSmall = 11,
    #[error("dispute window is outside the program safety bounds")]
    InvalidDisputeWindow = 12,
    #[error("the signed dispute window is still open or has already closed")]
    DisputeWindowState = 13,
}

impl From<SettlementError> for ProgramError {
    fn from(error: SettlementError) -> Self {
        Self::Custom(error as u32)
    }
}
