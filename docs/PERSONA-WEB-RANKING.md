# Persona web ranking implemented in PR #2

PR #9 introduced the persona-web direction. The current PR #2 keeps that model
with contributor terminology and the following executable boundary.

## Retrieval graph

- A document is the paid passage and search unit.
- A contributor owns one or more versioned memory-backed documents.
- Evidence edges connect independently owned documents with a topic, relation,
  provenance, weight, actor, and timestamp.
- Only curated or outcome-verified positive evidence passes authority.
- Paid, sponsored, inferred, self-owned, raw UGC, dispute, and lineage edges do
  not buy positive PageRank authority.

For a question, Rust combines local lexical/hash features with a query-specific
personalized PageRank teleport distribution. It applies category, demographic,
price, lock, consent/auto-match, and strike filters before returning candidates.
Bundle selection penalizes redundant passages and duplicate authors under the
buyer's requested count and KRW budget.

## Memory stream

Accepted answers create observation memories and searchable paid documents.
Private interview turns are retained as context but are not indexed or sold as
separate passages. Memory carries importance, reliability, content hash,
version, lock state, access count, last-access time, and source IDs.

Corrections append a new version and lock the superseded passage. Reflections
derive from multiple memories and keep their source IDs. Locking removes a
passage from active retrieval and quoting. Contributors can export their own
memory and access log.

## Public and paid boundary

Free discovery returns handles, shelf/category, price, score components, and
optional demographic bands, never passage text. Public contributor/document
manifests expose discovery metadata, hashes, versions, prices, and x402 links.
PR #9 `/personas/...` URLs remain compatibility aliases; `/contributors/...`
and `/documents/...` are canonical.

An opened passage is quote-bound to query, document, immutable content snapshot,
version, consent version, recipient, network, asset, atomic amount, conversion,
and expiry. Settlement is required before delivery. Synthesis reloads only
server-proven paid snapshots and requires the query's secret payment capability.

## Deliberate limits

The embedding is deterministic local feature hashing, not a learned multilingual
semantic model. Authority edges are seeded/admin curated, not a web-scale live
graph. Production needs calibrated relevance, adversarial/Sybil evaluation,
verified outcome ingestion, privacy-preserving public metadata, and continuous
ranking audits.
