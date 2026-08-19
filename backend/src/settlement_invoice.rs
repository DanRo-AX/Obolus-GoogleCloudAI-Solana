use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const SETTLEMENT_INVOICE_SCHEME: &str = "obulus-settlement-v1";
pub const SETTLEMENT_PREVIEW_SCHEME: &str = "obulus-settlement-preview-v1";
pub const HOSTED_PAY_SH_MODE: &str = "hosted_pay_sh";
pub const MAX_PROTOCOL_FEE_BPS: u64 = 1_000;

/// Buyer-readable, payment-rail-independent commitment created before money
/// can move. The browser sends `invoice_hash` back when it starts automatic
/// settlement, so the server fails closed if a document, recipient, amount,
/// consent version, or content version changed after the invoice was shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPreviewLineItem {
    pub document_handle: String,
    pub document_hash: String,
    pub document_version: u32,
    pub consent_version: String,
    pub recipient_wallet: String,
    pub price_krw: u64,
    pub amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_amount_atomic: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPreview {
    pub scheme: String,
    pub query_id: String,
    pub query_hash: String,
    pub document_bundle_root: String,
    pub network: String,
    pub asset: String,
    pub total_price_krw: u64,
    pub total_amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_fee_atomic: String,
    pub delivery_policy: String,
    pub line_items: Vec<SettlementPreviewLineItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPreviewEnvelope {
    pub invoice: SettlementPreview,
    pub invoice_hash: String,
}

impl SettlementPreview {
    pub fn validate(&self) -> Result<(), SettlementInvoiceError> {
        for (name, value) in [
            ("scheme", self.scheme.as_str()),
            ("queryId", self.query_id.as_str()),
            ("queryHash", self.query_hash.as_str()),
            ("documentBundleRoot", self.document_bundle_root.as_str()),
            ("network", self.network.as_str()),
            ("asset", self.asset.as_str()),
            ("deliveryPolicy", self.delivery_policy.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(SettlementInvoiceError::MissingField(name));
            }
        }
        if self.line_items.is_empty() {
            return Err(SettlementInvoiceError::TotalMismatch);
        }
        let total = parse_amount(&self.total_amount_atomic)?;
        let owner_total = parse_amount(&self.owner_amount_atomic)?;
        let platform_total = parse_amount(&self.platform_fee_atomic)?;
        let mut line_total = 0_u64;
        let mut line_owner_total = 0_u64;
        let mut line_platform_total = 0_u64;
        let mut maximum_platform_total = 0_u128;
        let mut handles = HashSet::with_capacity(self.line_items.len());
        for item in &self.line_items {
            for (name, value) in [
                ("documentHandle", item.document_handle.as_str()),
                ("documentHash", item.document_hash.as_str()),
                ("consentVersion", item.consent_version.as_str()),
                ("recipientWallet", item.recipient_wallet.as_str()),
            ] {
                if value.trim().is_empty() {
                    return Err(SettlementInvoiceError::MissingField(name));
                }
            }
            if !handles.insert(item.document_handle.as_str()) {
                return Err(SettlementInvoiceError::DuplicateQuote);
            }
            let amount = parse_amount(&item.amount_atomic)?;
            let owner = parse_amount(&item.owner_amount_atomic)?;
            let platform = parse_amount(&item.platform_amount_atomic)?;
            if amount == 0 || owner.checked_add(platform) != Some(amount) {
                return Err(SettlementInvoiceError::TotalMismatch);
            }
            let line_platform_ceiling = maximum_platform_share(amount);
            if platform > line_platform_ceiling {
                return Err(SettlementInvoiceError::PlatformFeeTooHigh);
            }
            maximum_platform_total = maximum_platform_total
                .checked_add(u128::from(line_platform_ceiling))
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
            line_total = line_total
                .checked_add(amount)
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
            line_owner_total = line_owner_total
                .checked_add(owner)
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
            line_platform_total = line_platform_total
                .checked_add(platform)
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
        }
        if line_total != total || line_owner_total != owner_total {
            return Err(SettlementInvoiceError::TotalMismatch);
        }
        if line_platform_total != platform_total {
            return Err(SettlementInvoiceError::PlatformFeeMismatch);
        }
        if owner_total.checked_add(platform_total) != Some(total) {
            return Err(SettlementInvoiceError::TotalMismatch);
        }
        if u128::from(platform_total) > maximum_platform_total {
            return Err(SettlementInvoiceError::PlatformFeeTooHigh);
        }
        Ok(())
    }

    pub fn hash(&self) -> Result<String, SettlementInvoiceError> {
        self.validate()?;
        let value = serde_json::to_value(self)
            .map_err(|error| SettlementInvoiceError::Canonicalization(error.to_string()))?;
        Ok(hex_digest(canonical_json(&value)?.as_bytes()))
    }

    pub fn envelope(self) -> Result<SettlementPreviewEnvelope, SettlementInvoiceError> {
        let invoice_hash = self.hash()?;
        Ok(SettlementPreviewEnvelope {
            invoice: self,
            invoice_hash,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementInvoiceLineItem {
    pub quote_id: String,
    pub document_handle: String,
    pub document_hash: String,
    pub document_version: u32,
    pub consent_version: String,
    pub recipient_wallet: String,
    pub amount_atomic: String,
    pub owner_amount_atomic: String,
    pub platform_amount_atomic: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementInvoice {
    pub scheme: String,
    pub settlement_mode: String,
    pub job_id: String,
    pub payer: String,
    pub authorization: String,
    pub refund_address: String,
    pub query_hash: String,
    pub document_bundle_root: String,
    pub network: String,
    pub asset: String,
    pub total_amount_atomic: String,
    pub platform_fee_atomic: String,
    pub expires_at: u64,
    pub delivery_policy: String,
    pub line_items: Vec<SettlementInvoiceLineItem>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SettlementInvoiceError {
    #[error("invoice field {0} is required")]
    MissingField(&'static str),
    #[error("invoice contains a duplicate quote id")]
    DuplicateQuote,
    #[error("invoice amount is not a valid unsigned integer")]
    InvalidAmount,
    #[error("invoice amount arithmetic overflowed")]
    AmountOverflow,
    #[error("invoice line-item totals do not equal the committed total")]
    TotalMismatch,
    #[error("invoice platform fees do not equal the committed platform total")]
    PlatformFeeMismatch,
    #[error("invoice protocol fee exceeds the configured safety ceiling")]
    PlatformFeeTooHigh,
    #[error("invoice could not be canonicalized: {0}")]
    Canonicalization(String),
}

impl SettlementInvoice {
    pub fn validate(&self) -> Result<(), SettlementInvoiceError> {
        for (name, value) in [
            ("scheme", self.scheme.as_str()),
            ("settlementMode", self.settlement_mode.as_str()),
            ("jobId", self.job_id.as_str()),
            ("payer", self.payer.as_str()),
            ("authorization", self.authorization.as_str()),
            ("refundAddress", self.refund_address.as_str()),
            ("queryHash", self.query_hash.as_str()),
            ("documentBundleRoot", self.document_bundle_root.as_str()),
            ("network", self.network.as_str()),
            ("asset", self.asset.as_str()),
            ("deliveryPolicy", self.delivery_policy.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(SettlementInvoiceError::MissingField(name));
            }
        }
        let total = parse_amount(&self.total_amount_atomic)?;
        let platform_total = parse_amount(&self.platform_fee_atomic)?;
        let mut line_total = 0_u64;
        let mut line_platform_total = 0_u64;
        let mut maximum_platform_total = 0_u128;
        let mut quote_ids = HashSet::with_capacity(self.line_items.len());
        for item in &self.line_items {
            for (name, value) in [
                ("quoteId", item.quote_id.as_str()),
                ("documentHandle", item.document_handle.as_str()),
                ("documentHash", item.document_hash.as_str()),
                ("consentVersion", item.consent_version.as_str()),
                ("recipientWallet", item.recipient_wallet.as_str()),
            ] {
                if value.trim().is_empty() {
                    return Err(SettlementInvoiceError::MissingField(name));
                }
            }
            if !quote_ids.insert(item.quote_id.as_str()) {
                return Err(SettlementInvoiceError::DuplicateQuote);
            }
            let amount = parse_amount(&item.amount_atomic)?;
            let owner = parse_amount(&item.owner_amount_atomic)?;
            let platform = parse_amount(&item.platform_amount_atomic)?;
            if amount == 0 || owner.checked_add(platform) != Some(amount) {
                return Err(SettlementInvoiceError::TotalMismatch);
            }
            let line_platform_ceiling = maximum_platform_share(amount);
            if platform > line_platform_ceiling {
                return Err(SettlementInvoiceError::PlatformFeeTooHigh);
            }
            maximum_platform_total = maximum_platform_total
                .checked_add(u128::from(line_platform_ceiling))
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
            line_total = line_total
                .checked_add(amount)
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
            line_platform_total = line_platform_total
                .checked_add(platform)
                .ok_or(SettlementInvoiceError::AmountOverflow)?;
        }
        if line_total != total {
            return Err(SettlementInvoiceError::TotalMismatch);
        }
        if line_platform_total != platform_total {
            return Err(SettlementInvoiceError::PlatformFeeMismatch);
        }
        if self.line_items.is_empty() && (total != 0 || platform_total != 0) {
            return Err(SettlementInvoiceError::TotalMismatch);
        }
        // Apply the ceiling per paid document because each individual split is
        // rounded up to an atomic unit. Comparing only with the aggregate would
        // reject a valid bundle of several micro-priced documents.
        if u128::from(platform_total) > maximum_platform_total {
            return Err(SettlementInvoiceError::PlatformFeeTooHigh);
        }
        Ok(())
    }

    pub fn hash(&self) -> Result<String, SettlementInvoiceError> {
        self.validate()?;
        let value = serde_json::to_value(self)
            .map_err(|error| SettlementInvoiceError::Canonicalization(error.to_string()))?;
        let canonical = canonical_json(&value)?;
        Ok(hex_digest(canonical.as_bytes()))
    }
}

pub fn canonical_json(value: &Value) -> Result<String, SettlementInvoiceError> {
    serde_json::to_string(&canonical_value(value))
        .map_err(|error| SettlementInvoiceError::Canonicalization(error.to_string()))
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        _ => value.clone(),
    }
}

fn parse_amount(value: &str) -> Result<u64, SettlementInvoiceError> {
    if value.is_empty() || (value.len() > 1 && value.starts_with('0')) {
        return Err(SettlementInvoiceError::InvalidAmount);
    }
    value
        .parse::<u64>()
        .map_err(|_| SettlementInvoiceError::InvalidAmount)
}

fn maximum_platform_share(amount_atomic: u64) -> u64 {
    if amount_atomic < 2 {
        return 0;
    }
    ((u128::from(amount_atomic) * u128::from(MAX_PROTOCOL_FEE_BPS)).div_ceil(10_000_u128))
        .clamp(1, u128::from(amount_atomic - 1)) as u64
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoice() -> SettlementInvoice {
        SettlementInvoice {
            scheme: SETTLEMENT_INVOICE_SCHEME.to_owned(),
            settlement_mode: HOSTED_PAY_SH_MODE.to_owned(),
            job_id: "bundle_1".to_owned(),
            payer: "buyer".to_owned(),
            authorization: "kms-agent".to_owned(),
            refund_address: "buyer".to_owned(),
            query_hash: "11".repeat(32),
            document_bundle_root: "22".repeat(32),
            network: "devnet".to_owned(),
            asset: "USDC".to_owned(),
            total_amount_atomic: "30".to_owned(),
            platform_fee_atomic: "2".to_owned(),
            expires_at: 2_000_000_000_000,
            delivery_policy: "paid_snapshot_only".to_owned(),
            line_items: vec![
                SettlementInvoiceLineItem {
                    quote_id: "q1".to_owned(),
                    document_handle: "A".to_owned(),
                    document_hash: "aa".repeat(32),
                    document_version: 3,
                    consent_version: "obulus.consent.v1".to_owned(),
                    recipient_wallet: "owner-a".to_owned(),
                    amount_atomic: "10".to_owned(),
                    owner_amount_atomic: "9".to_owned(),
                    platform_amount_atomic: "1".to_owned(),
                },
                SettlementInvoiceLineItem {
                    quote_id: "q2".to_owned(),
                    document_handle: "B".to_owned(),
                    document_hash: "bb".repeat(32),
                    document_version: 1,
                    consent_version: "obulus.consent.v1".to_owned(),
                    recipient_wallet: "owner-b".to_owned(),
                    amount_atomic: "20".to_owned(),
                    owner_amount_atomic: "19".to_owned(),
                    platform_amount_atomic: "1".to_owned(),
                },
            ],
        }
    }

    #[test]
    fn canonicalization_is_independent_of_object_insertion_order() {
        let left = serde_json::json!({"z": 1, "nested": {"b": 2, "a": 1}});
        let right = serde_json::json!({"nested": {"a": 1, "b": 2}, "z": 1});
        assert_eq!(
            canonical_json(&left).unwrap(),
            canonical_json(&right).unwrap()
        );
    }

    #[test]
    fn a_single_committed_field_changes_the_hash() {
        let original = invoice();
        assert_eq!(
            original.hash().unwrap(),
            "f568c237259a55b98f2c4f78e393fb3e081a64d4ee9d4d7f502e606d450ede71"
        );
        let mut changed = original.clone();
        changed.line_items[0].document_version += 1;
        assert_ne!(original.hash().unwrap(), changed.hash().unwrap());
    }

    #[test]
    fn line_item_and_platform_sums_fail_closed() {
        let mut wrong_total = invoice();
        wrong_total.total_amount_atomic = "31".to_owned();
        assert_eq!(
            wrong_total.validate(),
            Err(SettlementInvoiceError::TotalMismatch)
        );

        let mut wrong_platform = invoice();
        wrong_platform.platform_fee_atomic = "1".to_owned();
        assert_eq!(
            wrong_platform.validate(),
            Err(SettlementInvoiceError::PlatformFeeMismatch)
        );
    }

    #[test]
    fn duplicate_quote_ids_are_rejected() {
        let mut duplicate = invoice();
        duplicate.line_items[1].quote_id = duplicate.line_items[0].quote_id.clone();
        assert_eq!(
            duplicate.validate(),
            Err(SettlementInvoiceError::DuplicateQuote)
        );
    }

    #[test]
    fn per_document_atomic_rounding_is_validated_per_line() {
        let mut rounded = invoice();
        for item in &mut rounded.line_items {
            item.amount_atomic = "11".to_owned();
            item.owner_amount_atomic = "9".to_owned();
            item.platform_amount_atomic = "2".to_owned();
        }
        rounded.total_amount_atomic = "22".to_owned();
        rounded.platform_fee_atomic = "4".to_owned();

        assert_eq!(rounded.validate(), Ok(()));
    }
}
