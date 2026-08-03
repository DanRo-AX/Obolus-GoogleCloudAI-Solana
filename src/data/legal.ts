const ARTICLE = 'mx-auto flex max-w-2xl flex-col gap-5 px-4 py-12 sm:px-6 sm:py-16'
const H1 = 'text-2xl font-semibold leading-tight text-foreground sm:text-[2rem]'
const H2 = 'pt-8 text-lg font-semibold text-foreground'
const P = 'text-[15px] leading-7 text-foreground/90'
const LIST = 'list-disc space-y-2 pl-6 text-[15px] leading-7 text-foreground/90'
const META = 'font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground'
const LINK = 'underline decoration-dotted decoration-foreground/40 underline-offset-4'

export const TERMS_HTML = `<article class="${ARTICLE}">
<h1 class="${H1}">Terms of Service</h1>
<p class="${META}">Last updated: August 3, 2026 · Devnet release</p>
<p class="${P}">These terms cover the OPENSHELF chat, the author dashboard, My shelf, the SHELF-1 retrieval agent, open calls, and the payment functions behind them. The current release is restricted to Solana Devnet and test assets.</p>
<h2 class="${H2}">1. Documents and search</h2>
<p class="${P}">Accepted firsthand answers build an author-owned memory stream. Eligible passages become versioned documents with an anonymous handle, content hash, consent state, price, and payout address. Free search returns payment-safe metadata only. A passage is delivered only after the exact query-bound quote is paid.</p>
<p class="${P}">Ranking may use relevance, demographic and category filters, freshness, reliability, trust, personalized PageRank, author diversity, and budget. Ranking and payment prove provenance and access, not the truth or representativeness of a statement.</p>
<h2 class="${H2}">2. Accounts and documents</h2>
<ul class="${LIST}"><li>You must be at least 14, keep your credentials and your wallet secure, and provide information you are entitled to share.</li><li>Copyright remains with the author. You grant OPENSHELF the limited rights needed to store, index, quote, settle, and operate the service.</li><li>Private interview turns may be retained as memory context but are not sold as separate passages.</li><li>You may lock an eligible passage, append a correction, export your memory and access history, or delete the account.</li></ul>
<h2 class="${H2}">3. Opens and payment</h2>
<ul class="${LIST}"><li>Paying to read one document is an open. Each document carries its own price, shown in ₩ before you approve the open and settled in Devnet USDC.</li><li>The hosted website uses a fresh Phantom message signature to prove wallet possession and issue a revocable prepaid session. This session has no Solana private key or token allowance and can reserve only deposited OPENSHELF credit.</li><li>When credit is low, Phantom signs the selected Devnet USDC refill. A Cloud Run worker uses Pay.sh/MPP and a non-exportable Google Cloud KMS service signer to pay each selected DB independently.</li><li>Only successfully paid committed snapshots are delivered. Permanent partial failures restore the unopened atomic amount to prepaid credit. Remaining credit may be withdrawn to the verified wallet.</li><li>Confirmed on-chain transfers cannot be erased. Recovery and refund records are idempotent and may remain for accounting.</li></ul>
<h2 class="${H2}">4. Open calls</h2>
<p class="${P}">If human coverage is missing, the asker may choose a target count and rate per accepted answer. A paid call funds the exact target in one Devnet USDC approval. Accepted answers create deterministic payout claims; cancellation returns unused atomic units to the original payer. Zero-price calls have no token settlement and use the off-chain application ledger.</p>
<h2 class="${H2}">5. Thin shelves and AI baselines</h2>
<p class="${P}">When human coverage is thin, Gemini on Vertex AI may produce a free general baseline or author interview prompts. AI output is not human evidence, priced inventory, memory, authority, a paid citation, or author earnings. Private shelf passages are not sent to generate the baseline.</p>
<h2 class="${H2}">6. Quality, reports, and disputes</h2>
<p class="${P}">Off-topic, copied, fabricated, or generated answers may be voided. Askers who paid for a passage may submit usefulness feedback or a report. Upheld reports can reduce reliability or lock a document. Strikes can pause auto-match, hold payouts, or suspend an account. Authors may use the available dispute process; these controls do not guarantee accuracy.</p>
<h2 class="${H2}">7. Prohibited conduct</h2>
<ul class="${LIST}"><li>Submitting another person’s experience or generated text as your own firsthand record</li><li>Including another person’s personal information without authority</li><li>Using duplicate identities, fabricated links, or coordinated activity to manipulate ranking, calls, or settlement</li><li>Circumventing access controls, payment boundaries, rate limits, or attempting to reconstruct private shelves in bulk</li><li>Reverse-engineering the service or probing it for vulnerabilities without authorization</li></ul>
<h2 class="${H2}">8. Devnet and professional-use limitation</h2>
<p class="${P}">Devnet SOL and USDC have no production value or commercial finality. Mainnet, fiat checkout, subscriptions, and commercial custody are not enabled. Human experiences and AI baselines may be incomplete or wrong. Verify medical, legal, tax, financial, safety, and other high-impact decisions independently.</p>
<h2 class="${H2}">9. Deletion and service records</h2>
<p class="${P}">Account deletion removes the profile, documents, memory, and active matching state, revokes sessions, and prepares refunds or withdrawals for unused balances. Append-only financial rows are anonymized rather than silently rewritten; public blockchain records cannot be deleted.</p>
<h2 class="${H2}">10. Privacy and changes</h2>
<p class="${P}">Data handling is described in the <a class="${LINK} transition-colors hover:decoration-[#0E1470] dark:hover:decoration-[#DCFF71]" href="/privacy">Privacy Policy</a>. OPENSHELF may change or interrupt the service. Material changes should be reviewed before continued use. These terms are governed by the law of the Republic of Korea, subject to mandatory consumer protections.</p>
<h2 class="${H2}">11. No warranty and limitation of liability</h2>
<p class="${P}">The service is provided as it is. OPENSHELF does not warrant that a question has a matching document on the shelves, that a quoted passage is accurate or complete, or that the service runs without interruption. To the maximum extent the law allows, OPENSHELF is not liable for indirect, special, or consequential damages, or for lost profit. Damage caused by intent or gross negligence on the part of OPENSHELF, and liability set by consumer protection law, fall outside this limitation.</p>
<h2 class="${H2}">12. Contact</h2>
<p class="${P}">Questions about these terms go through the contact channel inside the service. OPENSHELF business registration details will be added to this document once they are settled.</p>
</article>`

export const PRIVACY_HTML = `<article class="${ARTICLE}">
<h1 class="${H1}">Privacy Policy</h1>
<p class="${META}">Last updated: August 3, 2026 · Devnet release</p>
<p class="${P}">OPENSHELF stores lived-experience records so they can become searchable, consent-bound human databases. This policy explains what remains private, what can be discovered, what a paid buyer receives, and what payment infrastructure sees.</p>
<h2 class="${H2}">1. Data collected</h2>
<ul class="${LIST}"><li><strong>Account:</strong> email, password verifier, session and security events, age confirmation, role.</li><li><strong>Profile:</strong> anonymous handle, optional demographic bands, fields, notification choices, conduct state.</li><li><strong>Memory:</strong> questions, accepted answers, private interview turns, importance, reliability, source links, corrections, reflections, versions, locks, and access history.</li><li><strong>Payment:</strong> public wallet addresses, one-time challenges and signatures, query/job identifiers, amounts, mints, networks, transaction signatures, prepaid ledger and payout/refund state.</li><li><strong>Service activity:</strong> queries, filters, ranking metadata, open calls, reservations, feedback, reports, and disputes.</li></ul>
<p class="${P}">Do not submit bank or card numbers, seed phrases, private keys, national identifiers, another person’s private information, or precise real-time location. OPENSHELF does not need them.</p>
<h2 class="${H2}">2. Discovery and paid disclosure</h2>
<p class="${P}">Free discovery may expose an anonymous handle, category, optional demographic bands, document price, version/hash metadata, and ranking components. It does not expose passage text, email, wallet address, or private interview turns.</p>
<p class="${P}">After a matching quote is settled, the asker receives the exact committed passage and citation. Other passages, the full memory stream, and private interview context remain closed. A previously delivered passage cannot be recalled from the recipient.</p>
<h2 class="${H2}">3. AI processing</h2>
<p class="${P}">When human coverage is thin, the asker’s question alone may be sent to Gemini on Vertex AI for a general baseline. Private shelf passages, identity details, wallet addresses, and payment records are excluded. Contributor prompt generation sends only broad fields and opted-in categories. Paid synthesis may process only server-proven paid snapshots.</p>
<h2 class="${H2}">4. Payment and public-chain data</h2>
<p class="${P}">Phantom keeps the user private key. OPENSHELF receives public addresses, signed proofs, and settled transaction data, not seed phrases or exportable keys. The service signer is held in Google Cloud KMS. Pay.sh, the Solana facilitator/RPC, and the public Devnet chain may process or expose wallet addresses, token amounts, signatures, and timestamps. Question text and passage content are not intentionally written on-chain.</p>
<h2 class="${H2}">5. Use of data</h2>
<ul class="${LIST}"><li>Authenticate accounts, protect sessions, and verify payout/prepaid wallet possession</li><li>Build memory, route open calls, rank eligible documents, and prevent redundant purchases</li><li>Deliver paid passages, synthesize citations, settle owners, and recover or refund failed jobs</li><li>Run quality checks, reports, strikes, disputes, security controls, and service audits</li></ul>
<h2 class="${H2}">6. Contributor controls</h2>
<p class="${P}">My Memory allows export, passage locking, corrections, access review, auto-match control, disputes, payout-wallet management, and account deletion. Locking removes a passage from new retrieval and quoting but does not undo an earlier paid delivery or public-chain transaction.</p>
<h2 class="${H2}">7. Deletion and retention</h2>
<p class="${P}">Deleting an account removes profile, documents, memory, active sessions, and matching state from the operational service and starts any required unused-balance payout. Financial and security events required for reconciliation are retained in anonymized append-only form. Public blockchain transactions are immutable. Operational backups and legally required records may expire on separate schedules.</p>
<h2 class="${H2}">8. Processors and security</h2>
<p class="${P}">Google Cloud services may host the application, Vertex AI, KMS, and secrets. Pay.sh and Solana infrastructure process payment requests. Access should be limited by service credentials and IAM, and sensitive responses use no-store controls. No system is risk-free; revoke sessions and contact the service if unauthorized access is suspected.</p>
<h2 class="${H2}">9. Rights, children, and contact</h2>
<p class="${P}">Users may access, correct, export, lock, or delete their information through the service where implemented. People under 14 may not sign up. Privacy requests and incident reports use the OPENSHELF contact channel. Read this policy with the <a class="${LINK}" href="/terms">Terms of Service</a>.</p>
</article>`

export const AI_LIQUIDITY_PRIVACY_NOTICE_HTML = `<aside class="mx-auto mb-12 max-w-2xl rounded-[6px] border border-[#6D5BD0]/25 bg-[#6D5BD0]/[0.04] px-4 py-4 sm:px-6"><p class="font-mono text-[10px] font-medium uppercase tracking-[1px] text-[#5540BE]">AI boundary</p><p class="mt-2 text-[14px] leading-6 text-foreground/85">Gemini supplies general orientation and interview prompts, not human inventory. Free baseline requests exclude private shelf passages; paid synthesis is restricted to server-proven purchased snapshots. AI output cannot earn, rank as a person, fill a human slot, or become a sellable citation.</p></aside>`
