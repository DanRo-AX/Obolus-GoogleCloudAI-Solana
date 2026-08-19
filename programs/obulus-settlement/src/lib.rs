//! Trust-minimized settlement for Obulus evidence invoices.
//!
//! The program never sees a question or a private passage. It commits only to
//! hashes, exact token accounts, exact amounts, expiry and refund policy. The
//! buyer (or a buyer-selected local agent) must acknowledge the delivery root
//! before the program can release the escrowed USDC.

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

/// Program entrypoint shared by SBF and native tests.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process(program_id, accounts, instruction_data)
}
