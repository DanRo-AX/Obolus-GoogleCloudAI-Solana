# Obulus pitch-deck master prompt

Copy everything below into a fresh AI session.

---

You are a product strategist and pitch-deck writer. Create a concise Korean
pitch deck for **Obulus**, a project submitted to a Google Cloud × Solana
hackathon. The audience knows AI and business but should not need prior knowledge
of x402, Pay.sh, PageRank or social world models.

The deck must balance two goals. A first-time audience should understand the
necessity within the first three slides, while a technical judge should still
see that Obulus contains original system design rather than a thin AI/Web3
wrapper. Do not list every endpoint, but do not remove the mechanisms that make
the business credible.

Make anyone understand, in this order:

1. why valuable human knowledge is missing from today's internet;
2. why that knowledge can become an owned, reusable asset;
3. how Obulus makes it searchable and payable;
4. why AI agents, Google Cloud and Solana make this possible now;
5. why the resulting market can become very large.

Then prove that this is not just a concept by showing the search engine, memory
system, payment boundary, agent interface and live infrastructure behind it.

## Product definition

Use this as the source of truth:

> Obulus is a paid search engine for human experience. It lets an AI agent
> search consented firsthand human databases, pay only for the evidence it
> opens, and settle each access to the data owner in Solana USDC.

Suggested one-line pitch:

> **Obulus turns lived human experience into a searchable, payable web for AI
> agents.**

Do not describe Obulus as a survey app, a persona marketplace, a ChatGPT wrapper
or a system that clones people. Social-world-model companies such as Simile are
evidence that detailed human interview data is becoming strategically valuable,
but Obulus solves a different problem: ownership, discovery, consent, pricing,
access and settlement of real human evidence.

## The problem everyone must understand

Public search engines can only index what people have already published. General
LLMs mainly reproduce patterns from public or licensed training data. The most
valuable domain-specific knowledge often remains in people's private lived
experience:

- what residents in Paris actually eat after work;
- what small café owners really pay suppliers;
- what an engineer learned during a failed migration;
- what a patient, parent or local resident experienced recently.

Companies repeatedly recruit people, conduct interviews and compress the result
into one-off reports. The respondent is paid once, the same research is repeated,
and the original experience rarely becomes a reusable asset.

Obulus changes the economic unit from “one research project” to “one piece of
human evidence opened.” A person can answer once, keep control of the record and
earn again when a future agent pays to use that evidence.

## Original ideas that must remain in the main story

The following are not secondary implementation details. They are Obulus's own
product and system insights and must appear in the main deck at an understandable
level:

1. **A personal DB is a website; a consented memory is a page; access is a paid
   URL.** This is the conceptual bridge between web search and human data.
2. **Discovery is free, evidence is paid.** Agents may rank handles, prices,
   categories, hashes and quality signals without seeing private passage text.
3. **Rank before paying.** The agent does not query and pay every person. It
   selects a small, independent, budget-constrained evidence bundle first.
4. **Authority cannot simply be bought.** Query-specific authority may propagate
   through independent corroboration and verified outcomes, but paid, sponsored,
   self-referential or copied relations must not mint positive rank.
5. **A search MISS is a supply signal.** Missing coverage automatically becomes
   a precisely targeted Open Call, so demand grows the corpus instead of merely
   returning an empty result.
6. **Human memory compounds.** One accepted answer becomes an immutable,
   consent-versioned document that can be corrected, locked, cited and paid for
   again without generatively impersonating its author.
7. **AI liquidity and human inventory are separated.** Gemini can orient,
   interview and synthesize, but a free AI answer cannot masquerade as human
   evidence or undercut existing human supply.
8. **Payment controls information flow.** The synthesis model receives only the
   exact passage snapshots whose payment and delivery callback were verified.
9. **One approval is bounded, not unlimited.** Phantom, the internal prepaid
   capability, the KMS service key and a local Pay.sh wallet are distinct keys
   and authorities.
10. **The product is an agent protocol surface as well as a website.** CLI/MCP
    allows an external AI agent to search, quote, pay, recover, commission human
    research and inspect memory or earnings.

These ten ideas should be expressed through diagrams and examples, not dense
walls of text.

## The Google web insight

Explain this with one simple visual, not a lecture on search algorithms.

Google made the public web useful by treating pages as addressable documents,
indexing them and ranking the most useful pages before a user opened them.
Obulus applies that abstraction to the missing human web:

| Public web | Obulus |
| --- | --- |
| Website | One person's consented experience DB |
| Web page | One human evidence document |
| URL | Stable paid resource endpoint |
| Search index | Free searchable metadata |
| Link authority | Independently verified evidence relationships |
| PageRank/search ranking | Query-specific relevance, trust, freshness, diversity and authority |
| Click | Paid evidence open |
| Ad value | Direct payment to the evidence owner |

Use the line:

> Google indexed the public web. Obulus is building the paid human web.

Be technically accurate. Obulus is inspired by the abstraction of URLs, indexing,
ranking and spam resistance; it does not claim to copy Google's current
proprietary search algorithm. In the current prototype, candidates are ranked by
text relevance, term coverage, query-specific personalized PageRank, author
trust, freshness, independent-author diversity, redundancy and buyer budget.

The main deck should show this ranking pipeline and explain why it prevents the
agent from paying every DB. Keep exact weights and iteration counts in the
appendix, but keep personalized authority, anti-paid-link rules, diversity and
budget-constrained bundle selection in the main explanation.

## The product flow

Show one question splitting into HIT and MISS.

### HIT — relevant human evidence already exists

1. The user asks a natural-language question.
2. Obulus searches metadata for free.
3. It ranks relevant human DB documents and selects only the minimum independent
   evidence set needed for the answer.
4. It shows an exact total price.
5. The user approves a bounded question budget once.
6. The agent pays each selected DB through x402/Pay.sh and Solana Devnet USDC.
7. Only paid passage snapshots are opened.
8. Gemini synthesizes those passages with citations, preserving agreement and
   disagreement.
9. Each data owner receives payment.

### MISS — evidence is missing or too thin

1. Gemini can provide a clearly labelled free general baseline.
2. Obulus explicitly says which human evidence is missing.
3. The buyer creates an Open Call with target, people count and reward.
4. A conversational interview agent asks follow-up questions that require
   concrete lived detail rather than low-effort text.
5. Accepted answers solve the current question and enter the contributor's
   consented memory DB.
6. The next similar question can become a HIT.

The core flywheel is:

> Query → search → paid reuse, or MISS → Open Call → new human memory → future
> paid reuse.

## Memory, quality and trust

Include a concise but real explanation of how a human answer becomes a reusable
asset.

- An accepted firsthand answer becomes an observation and a sellable document.
- The document receives a content hash, immutable version, consent version,
  author/recipient binding and access history.
- A correction creates a new version rather than overwriting what a previous
  buyer paid to open.
- Private interview warm-up context is not automatically sold as a document.
- Reflections may help retrieval but retain source IDs and are not independently
  sold as if they were new human testimony.
- Auto-match may reuse an exact prior paid answer only for a sufficiently
  near-identical question and never invent a response in the contributor's voice.

Show the quality defense as a layered system:

1. minimum detail and specificity;
2. time, place, price or concrete-event anchors;
3. question-echo, repetition, copied-text and near-duplicate detection;
4. author reliability and paid-buyer feedback;
5. strikes, payout holds, disputes and suspension;
6. provenance edges that distinguish independent corroboration from paid or
   self-created authority.

Do not overload the slide with numeric thresholds. Put the exact thresholds and
formulas in the appendix as proof that the mechanism is implemented.

## Why x402, Pay.sh and Solana are necessary

Explain protocols in plain language:

- A human evidence document behaves like a paid URL.
- A request to its locked body can return HTTP `402 Payment Required` with the
  price, network and recipient.
- x402 defines the HTTP-native payment boundary.
- Pay.sh lets CLI tools and AI agents detect x402/MPP challenges, arrange signing
  through a protected wallet backend and retry the request with payment proof.
- Solana USDC provides a low-cost settlement rail for paying several independent
  data owners at document-level granularity.

The hosted web flow and local CLI flow must be distinguished:

- On the website, Phantom proves wallet ownership and signs an occasional
  bounded Devnet USDC refill. A revocable prepaid capability lets the server
  reserve only that internal balance. It is not permission to withdraw freely
  from the user's Phantom wallet.
- The server payment key is separate and non-exportable in Google Cloud KMS.
- For an external agent, Pay.sh keeps its payment key in the local OS credential
  store; the AI agent never receives the raw private key.

Use the line:

> Automatic payment means policy-bounded settlement, not unrestricted access to
> a user's wallet.

Also state that payment proves which committed passage was opened, its owner,
version and recipient. Payment does not prove that a statement is true.

## Gemini and Google Cloud

Gemini must not appear as a decorative chatbot. Show its three precise roles:

1. demand-side baseline when human coverage is missing;
2. interview follow-up questions that help contributors create specific human
   evidence;
3. post-purchase synthesis using only server-verified paid passages and an
   allowlist of citations.

Deterministic services enforce consent, version, hash, quote, payment and
delivery. Probabilistic AI interprets questions and synthesizes evidence.

Google Cloud architecture:

- Vertex AI / Gemini
- Cloud Run backend and payment orchestrator
- Cloud KMS non-exportable Solana signing key
- Secret Manager for RPC and internal credentials
- Cloud Build deployment

Do not claim Google ADK, A2A or AP2 are implemented unless the repository proves
it. MCP is implemented for agent tools. A2A and AP2 may be shown only as future
interoperability and payment-authorization standards.

## CLI/MCP proof

Obulus is not only a consumer website. The repository exposes 23 marketplace
tools through CLI/MCP, including free human-DB search, exact quotes, payment
preparation, paid-evidence synthesis, Open Calls, contributor memory and
earnings. This proves that an external AI agent can use the marketplace without
manually navigating the website.

## Business model and moat

Target customers:

- consumer-insight and market-research teams;
- brands, retail, F&B and travel companies needing local experience;
- consulting, investment and niche industry research;
- AI and social-world-model companies needing consented, updateable human data;
- autonomous agents that need evidence unavailable on the public web.

Potential revenue, clearly marked as a business model rather than current
revenue:

- fee on settled evidence opens;
- a protocol fee on each successfully settled evidence open;
- Open Call commissioning and quality-control fees;
- paid API/MCP access and enterprise SLA.

The moat is not the blockchain alone. It is the compounding graph of:

- human memory;
- real buyer demand and search misses;
- evidence relationships and provenance;
- paid usage and reuse;
- buyer feedback and outcomes.

Make the strategic implication explicit: social-world-model companies spend
heavily to collect deep interviews because human context is becoming valuable
model infrastructure. Obulus can become the permission, discovery and settlement
layer from which those companies, research teams and autonomous agents acquire
fresh human evidence. Unlike a centralized panel that captures all reuse value,
Obulus lets contributors participate in the economics of repeated access.

## Main-deck structure

Create a 15-slide Korean pitch deck. A six-to-eight-minute version may move
quickly through the first slides, but the written deck should retain enough
technical substance for independent reading.

1. Cover — Obulus and the one-line pitch
2. The missing human web — why public search and general LLMs miss lived experience
3. Why now — social world models make deep human data valuable, but contributors do not share in reuse value
4. The solution — search people, pay only for opened evidence
5. Google Web → Obulus — personal DB/site, memory/page, paid URL, rank and open
6. Product flow — HIT buys a minimal evidence set; MISS creates an Open Call
7. Search engine — free metadata discovery, personalized authority, anti-spam, diversity and budget selection
8. Human memory asset — observation, immutable version, consent, correction, reuse and quality enforcement
9. Contributor flywheel — answer once, retain control, earn on future qualified reuse
10. Gemini + Google Cloud — baseline, interview and paid-evidence synthesis with deterministic guardrails
11. x402 + Pay.sh + Solana — document-level settlement, delivery verification and recovery
12. Wallet and key separation — Phantom, prepaid capability, KMS service signer and local Pay.sh account
13. CLI/MCP — the same marketplace callable by external AI agents through 23 tools
14. Enterprise market, business model and compounding data moat
15. Live proof, judging-criteria summary and the paid-human-web vision

For each slide provide:

- a short title;
- one sentence the audience must remember;
- two to four short content blocks or one strong system diagram;
- the recommended screenshot or diagram;
- 30–45 seconds of speaker notes;
- the hackathon criterion it supports.

Keep the core mechanisms in the main deck: query-specific PageRank, paid-authority
exclusion, budgeted evidence selection, immutable consented memory, quality
defense, paid-passage-only synthesis, bounded authorization, KMS signing,
idempotent recovery and CLI/MCP. Put only their exact constants, exhaustive edge
cases, full state machines and code-level details in the appendix.

The appendix should include:

- ranking score and personalized PageRank details;
- memory lifecycle and quality thresholds;
- payment/delivery state machine and duplicate-payment recovery;
- security and key-authority matrix;
- test inventory and Devnet evidence;
- current limitations and production roadmap.

## Screenshots to use

Use the images in `docs/pitch-deck-assets`.

Prioritize:

- `03-login-product-flow.png`
- `10-chat-hit-exact-quote.png`
- `09-chat-ranked-human-evidence.png`
- `08-dashboard-live-demand.png`
- `07-onboarding-wallet-and-x402.png`
- `11-cli-mcp-agent-interface.png`

The current screenshots contain legacy `OPENSHELF` and `SHELF-1` labels. The
official pitch brand is Obulus and the agent is Obulus Agent. Do not silently
alter screenshots and claim the rebrand is already shipped. Recommend recapture
after the UI strings are changed.

## Hackathon evidence

Make the judging criteria visible without turning the deck into a checklist:

- Innovation/UX: one question, free search, one bounded approval, paid citations,
  and automatic Open Call on a miss.
- Gemini/Google Cloud: Vertex AI baseline, interview prompts, paid-evidence
  synthesis, Cloud Run, KMS and Secret Manager.
- Blockchain/infrastructure: Solana Devnet USDC, x402, Pay.sh, durable settlement
  and CLI/MCP.
- Real operation: live URL, transaction signature, Explorer link, owner balance
  change, payment log and returned paid passage.

Be honest about verification. At the current reference point the codebase had 90
passing tests and the Rust API, x402 gateway and Pay.sh installation were ready.
The local Pay account shown by `agent:doctor` was not yet funded/configured for a
live paid action. Do not present sandbox readiness as a completed hosted Pay.sh
Devnet settlement. Make one real Devnet payment receipt a P0 item before the
final demo.

## Tone and final message

Use plain language before protocol names. Lead with human and economic meaning,
then reveal the technical mechanism. Avoid unexplained crypto jargon and long
formulas, but preserve the product's original search, memory, authority and
payment design. Every technical slide must answer a business question: why the
answer is cheaper, more trustworthy, more reusable or more defensible.

End with:

> The web made public information searchable. Obulus makes human experience
> searchable, permissioned and payable.

Now inspect the current repository, correct any facts that have changed, and
write the complete 15-slide deck with actual slide copy, speaker notes, image
placement, appendix recommendations and both a 6-minute and 10-minute demo
script. Do not return only an outline.
