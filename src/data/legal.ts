const ARTICLE = 'mx-auto flex max-w-2xl flex-col gap-5 px-4 py-12 sm:px-6 sm:py-16'
const H1 = 'text-2xl font-semibold leading-tight text-foreground sm:text-[2rem]'
const H2 = 'pt-8 text-lg font-semibold text-foreground'
const P = 'text-[15px] leading-7 text-foreground/90'
const LIST = 'list-disc space-y-2 pl-6 text-[15px] leading-7 text-foreground/90'
const META = 'font-mono text-xs font-medium uppercase tracking-[1px] text-muted-foreground'
const LINK = 'underline decoration-dotted decoration-foreground/40 underline-offset-4'

export const TERMS_HTML = `<article class="${ARTICLE}">
<h1 class="${H1}">Terms of Service</h1>
<p class="${META}">Last updated: August 9, 2026 · Devnet wallet-only release</p>
<p class="${P}">These terms cover the Obolus chat, the author dashboard, My database, the Obolus retrieval agent, open calls, and the payment functions behind them. The current release is restricted to Solana Devnet and test assets.</p>
<h2 class="${H2}">1. Documents and search</h2>
<p class="${P}">Accepted firsthand answers build an author-owned memory stream. Eligible passages become versioned documents with an anonymous handle, content hash, consent state, price, and payout address. Free search returns payment-safe metadata only. A passage is delivered only after the exact query-bound quote is paid.</p>
<p class="${P}">Ranking may use relevance, demographic and category filters, freshness, reliability, trust, personalized PageRank, author diversity, and budget. Ranking and payment prove provenance and access, not the truth or representativeness of a statement.</p>
<h2 class="${H2}">2. Accounts and documents</h2>
<ul class="${LIST}"><li>You must be at least 14, keep your credentials and your wallet secure, and provide information you are entitled to share.</li><li>Copyright remains with the author. You grant Obolus the limited rights needed to store, index, quote, settle, and operate the service.</li><li>Private interview turns may be retained as memory context but are not sold as separate passages.</li><li>You may lock an eligible passage, append a correction, export your memory and access history, or delete the account.</li></ul>
<h2 class="${H2}">3. Opens and payment</h2>
<ul class="${LIST}"><li>Paying to read one document is an open. Each document carries an exact Devnet USDC price shown before approval.</li><li>The hosted website uses a fresh Phantom message signature to prove wallet possession and issue a revocable prepaid session. This session has no Solana private key or token allowance and can reserve only deposited Obolus credit.</li><li>Phantom signs a Devnet USDC top-up only when the user explicitly starts it from My Database. Document opens never pull additional wallet funds. A Cloud Run worker uses Pay.sh/MPP and a non-exportable Google Cloud KMS service signer to pay each selected database independently from existing prepaid credit.</li><li>Only successfully paid committed snapshots are delivered. Permanent partial failures restore the unopened atomic amount to prepaid credit. Remaining credit may be withdrawn to the verified wallet.</li><li>Confirmed on-chain transfers cannot be erased. Recovery and refund records are idempotent and may remain for accounting.</li></ul>
<h2 class="${H2}">4. Open calls</h2>
<p class="${P}">If human coverage is missing, the asker may choose a target count and a positive Devnet USDC reward per accepted answer. The call reserves the exact funded target from prepaid credit. Accepted answers create deterministic payout claims; cancellation returns unused atomic units to the original payer. Obolus does not create zero-price or application-ledger-only calls.</p>
<h2 class="${H2}">5. Human coverage gaps and AI baselines</h2>
<p class="${P}">When human coverage is thin, Gemini on Vertex AI may produce a free general baseline or author interview prompts. AI output is not human evidence, priced inventory, memory, authority, a paid citation, or author earnings. Private database passages are not sent to generate the baseline.</p>
<h2 class="${H2}">6. Quality, reports, and disputes</h2>
<p class="${P}">Off-topic, copied, fabricated, or generated answers may be voided. Askers who paid for a passage may submit usefulness feedback or a report. Upheld reports can reduce reliability or lock a document. Strikes can pause auto-match, hold payouts, or suspend an account. Authors may use the available dispute process; these controls do not guarantee accuracy.</p>
<h2 class="${H2}">7. Prohibited conduct</h2>
<ul class="${LIST}"><li>Submitting another person’s experience or generated text as your own firsthand record</li><li>Including another person’s personal information without authority</li><li>Using duplicate identities, fabricated links, or coordinated activity to manipulate ranking, calls, or settlement</li><li>Circumventing access controls, payment boundaries, rate limits, or attempting to reconstruct private databases in bulk</li><li>Reverse-engineering the service or probing it for vulnerabilities without authorization</li></ul>
<h2 class="${H2}">8. Devnet and professional-use limitation</h2>
<p class="${P}">Devnet SOL and USDC have no production value or commercial finality. Mainnet, fiat checkout, subscriptions, and commercial custody are not enabled. Human experiences and AI baselines may be incomplete or wrong. Verify medical, legal, tax, financial, safety, and other high-impact decisions independently.</p>
<h2 class="${H2}">9. Deletion and service records</h2>
<p class="${P}">Account deletion removes the profile, documents, memory, and active matching state, revokes sessions, and prepares refunds or withdrawals for unused balances. Append-only financial rows are anonymized rather than silently rewritten; public blockchain records cannot be deleted.</p>
<h2 class="${H2}">10. Privacy and changes</h2>
<p class="${P}">Data handling is described in the <a class="${LINK} transition-colors hover:decoration-[#0E1470] dark:hover:decoration-[#DCFF71]" href="/privacy">Privacy Policy</a>. Obolus may change or interrupt the service. Material changes should be reviewed before continued use. These terms are governed by the law of the Republic of Korea, subject to mandatory consumer protections.</p>
<h2 class="${H2}">11. No warranty and limitation of liability</h2>
<p class="${P}">The service is provided as it is. Obolus does not warrant that a question has a matching document in its human databases, that a quoted passage is accurate or complete, or that the service runs without interruption. To the maximum extent the law allows, Obolus is not liable for indirect, special, or consequential damages, or for lost profit. Damage caused by intent or gross negligence on the part of Obolus, and liability set by consumer protection law, fall outside this limitation.</p>
<h2 class="${H2}">12. Contact</h2>
<p class="${P}">Questions about these terms go through the contact channel inside the service. Obolus business registration details will be added to this document once they are settled.</p>
</article>`

/**
 * Korean legal text.
 *
 * Same markup, same class constants, same hrefs — only the sentences change, so
 * both languages lay out identically. The plain register holds (하십시오체
 * 평서형, no imperative, no honorific -시-), but obligations are allowed the
 * longer sentences they need: legal copy is the one place where clipping a
 * sentence in half would change what it means.
 */
export const TERMS_HTML_KO = `<article class="${ARTICLE}">
<h1 class="${H1}">이용약관</h1>
<p class="${META}">최종 수정: 2026년 8월 3일 · Devnet 릴리스</p>
<p class="${P}">이 약관은 Obolus 채팅, 저자 대시보드, 내 데이터베이스, Obolus 검색 에이전트, 공개 모집, 그리고 그 뒤의 결제 기능에 적용됩니다. 현재 릴리스는 Solana Devnet과 테스트 자산으로 제한됩니다.</p>
<h2 class="${H2}">1. 문서와 검색</h2>
<p class="${P}">수락된 직접 경험 답변은 저자가 소유하는 기억 흐름을 이룹니다. 조건을 갖춘 구절은 익명 활동명, 내용 해시, 동의 상태, 가격, 정산 주소가 붙은 버전 문서가 됩니다. 무료 검색은 결제에 안전한 메타데이터만 돌려줍니다. 구절은 질문에 묶인 해당 인용의 값이 치러진 뒤에만 전달됩니다.</p>
<p class="${P}">순위 산정에는 관련성, 인구 구간과 분야 필터, 최신성, 신뢰도, 신뢰 관계, 개인화 PageRank, 저자 다양성, 예산이 쓰일 수 있습니다. 순위와 결제는 출처와 접근을 증명합니다. 진술의 진위나 대표성을 증명하지는 않습니다.</p>
<h2 class="${H2}">2. 계정과 문서</h2>
<ul class="${LIST}"><li>만 14세 이상이어야 합니다. 자격 증명과 지갑은 직접 안전하게 관리해야 하고, 공유할 권한이 있는 정보만 올려야 합니다.</li><li>저작권은 저자에게 남습니다. 저장, 색인, 인용, 정산, 서비스 운영에 필요한 범위의 제한적 권리를 Obolus에 부여합니다.</li><li>비공개 인터뷰 대화는 기억 맥락으로 보관될 수 있지만, 별도 구절로 팔리지 않습니다.</li><li>조건을 갖춘 구절을 잠그거나, 정정을 덧붙이거나, 기억과 열람 기록을 내보내거나, 계정을 삭제할 수 있습니다.</li></ul>
<h2 class="${H2}">3. 열기와 결제</h2>
<ul class="${LIST}"><li>문서 1건을 읽으려고 값을 내는 것이 열기입니다. 문서마다 정확한 Devnet USDC 가격이 있으며 승인 전에 전액을 보여줍니다.</li><li>이 웹사이트는 새 Phantom 메시지 서명으로 지갑 소유를 증명하고, 철회할 수 있는 선불 세션을 발급합니다. 이 세션에는 Solana 개인 키도 토큰 승인 한도도 없고, 예치된 Obolus 잔액만 잡아 둘 수 있습니다.</li><li>Phantom은 사용자가 내 데이터베이스에서 직접 시작한 Devnet USDC 충전에만 서명합니다. 문서 열람은 지갑에서 추가 자금을 가져가지 않습니다. Cloud Run 작업자는 기존 선불 잔액 안에서 Pay.sh/MPP와 내보낼 수 없는 Google Cloud KMS 서비스 서명자를 써서 선택된 데이터베이스마다 따로 정산합니다.</li><li>결제가 끝난 확정 스냅숏만 전달됩니다. 영구적인 부분 실패가 나면 열리지 않은 최소 단위 금액이 선불 잔액으로 돌아갑니다. 남은 잔액은 인증된 지갑으로 출금할 수 있습니다.</li><li>확정된 온체인 송금은 지울 수 없습니다. 복구와 환불 기록은 멱등이며 회계를 위해 남을 수 있습니다.</li></ul>
<h2 class="${H2}">4. 공개 모집</h2>
<p class="${P}">사람이 채운 몫이 없으면 질문자가 목표 건수와 수락 답변 1건당 양수의 Devnet USDC 보상을 정할 수 있습니다. 모집은 선불 잔액에서 목표 금액을 정확히 예약합니다. 수락된 답변은 확정된 정산 청구를 만듭니다. 취소하면 쓰지 않은 최소 단위가 원래 결제자에게 돌아갑니다. Obolus는 무료 모집이나 애플리케이션 장부만 사용하는 모집을 만들지 않습니다.</p>
<h2 class="${H2}">5. 부족한 인간 근거와 AI 기준선</h2>
<p class="${P}">사람이 채운 몫이 부족하면 Vertex AI의 Gemini가 무료 일반 기준선이나 저자 인터뷰 질문을 만들 수 있습니다. AI 출력은 사람의 증거도, 값이 붙은 재고도, 기억도, 권위도, 유료 인용도, 저자 수익도 아닙니다. 기준선을 만들 때 비공개 데이터베이스의 구절은 보내지 않습니다.</p>
<h2 class="${H2}">6. 품질, 신고, 이의 신청</h2>
<p class="${P}">주제에서 벗어났거나, 베꼈거나, 지어냈거나, 생성된 답변은 무효가 될 수 있습니다. 구절에 값을 낸 질문자는 유용성 평가나 신고를 제출할 수 있습니다. 확정된 신고는 신뢰도를 낮추거나 문서를 잠글 수 있습니다. 스트라이크는 자동 매칭을 멈추거나, 정산을 보류하거나, 계정을 정지할 수 있습니다. 저자는 마련된 이의 신청 절차를 쓸 수 있습니다. 이 장치들이 정확성을 보장하지는 않습니다.</p>
<h2 class="${H2}">7. 금지 행위</h2>
<ul class="${LIST}"><li>다른 사람의 경험이나 생성된 글을 직접 겪은 기록으로 올리는 행위</li><li>권한 없이 다른 사람의 개인 정보를 포함하는 행위</li><li>중복 신원, 조작된 링크, 조직적 활동으로 순위·모집·정산을 조작하는 행위</li><li>접근 통제, 결제 경계, 호출 제한을 우회하거나 비공개 데이터베이스를 대량으로 복원하려는 행위</li><li>서비스를 역설계하거나 허가 없이 취약점을 탐색하는 행위</li></ul>
<h2 class="${H2}">8. Devnet과 전문적 이용 제한</h2>
<p class="${P}">Devnet SOL과 USDC에는 실사용 가치도 상업적 확정성도 없습니다. 메인넷, 법정화폐 결제, 구독, 상업적 수탁은 열려 있지 않습니다. 사람의 경험과 AI 기준선은 불완전하거나 틀릴 수 있습니다. 의료·법률·세무·금융·안전처럼 영향이 큰 결정은 따로 확인해야 합니다.</p>
<h2 class="${H2}">9. 삭제와 서비스 기록</h2>
<p class="${P}">계정을 삭제하면 프로필, 문서, 기억, 진행 중인 매칭 상태가 지워지고, 세션이 끊기고, 쓰지 않은 잔액의 환불이나 출금이 준비됩니다. 추가만 가능한 금융 기록은 몰래 고쳐 쓰는 대신 익명 처리합니다. 공개 블록체인 기록은 지울 수 없습니다.</p>
<h2 class="${H2}">10. 개인정보와 변경</h2>
<p class="${P}">데이터 처리 방식은 <a class="${LINK} transition-colors hover:decoration-[#0E1470] dark:hover:decoration-[#DCFF71]" href="/privacy">개인정보 처리방침</a>에 적혀 있습니다. Obolus는 서비스를 바꾸거나 중단할 수 있습니다. 중요한 변경은 계속 이용하기 전에 확인해야 합니다. 이 약관은 대한민국 법을 따르며, 강행 소비자 보호 규정이 우선합니다.</p>
<h2 class="${H2}">11. 보증 부인과 책임 제한</h2>
<p class="${P}">서비스는 있는 그대로 제공됩니다. Obolus는 질문에 맞는 문서가 데이터베이스에 있다는 것, 인용된 구절이 정확하거나 완전하다는 것, 서비스가 중단 없이 돌아간다는 것을 보증하지 않습니다. 법이 허용하는 최대 범위에서 Obolus는 간접·특별·결과적 손해와 일실 이익에 책임지지 않습니다. Obolus의 고의나 중과실로 생긴 손해, 소비자 보호법이 정한 책임은 이 제한에서 빠집니다.</p>
<h2 class="${H2}">12. 문의</h2>
<p class="${P}">약관 관련 문의는 서비스 안의 문의 창구로 받습니다. Obolus 사업자 등록 정보는 확정되는 대로 이 문서에 넣습니다.</p>
</article>`

export const PRIVACY_HTML = `<article class="${ARTICLE}">
<h1 class="${H1}">Privacy Policy</h1>
<p class="${META}">Last updated: August 3, 2026 · Devnet release</p>
<p class="${P}">Obolus stores lived-experience records so they can become searchable, consent-bound human databases. This policy explains what remains private, what can be discovered, what a paid buyer receives, and what payment infrastructure sees.</p>
<h2 class="${H2}">1. Data collected</h2>
<ul class="${LIST}"><li><strong>Account:</strong> public wallet address, one-time sign-in challenges and signatures, session and security events, age confirmation, role.</li><li><strong>Profile:</strong> anonymous handle, optional demographic bands, fields, notification choices, conduct state.</li><li><strong>Memory:</strong> questions, accepted answers, private interview turns, importance, reliability, source links, corrections, reflections, versions, locks, and access history.</li><li><strong>Payment:</strong> payer and recipient wallet addresses, query/job identifiers, amounts, mints, networks, transaction signatures, prepaid ledger and payout/refund state.</li><li><strong>Service activity:</strong> queries, filters, ranking metadata, open calls, reservations, feedback, reports, and disputes.</li></ul>
<p class="${P}">Do not submit bank or card numbers, seed phrases, private keys, national identifiers, another person’s private information, or precise real-time location. Obolus does not need them.</p>
<h2 class="${H2}">2. Discovery and paid disclosure</h2>
<p class="${P}">Free discovery may expose an anonymous handle, category, optional demographic bands, document price, version/hash metadata, and ranking components. It does not expose passage text, email, wallet address, or private interview turns.</p>
<p class="${P}">After a matching quote is settled, the asker receives the exact committed passage and citation. Other passages, the full memory stream, and private interview context remain closed. A previously delivered passage cannot be recalled from the recipient.</p>
<h2 class="${H2}">3. AI processing</h2>
<p class="${P}">When human coverage is thin, the asker’s question alone may be sent to Gemini on Vertex AI for a general baseline. Private database passages, identity details, wallet addresses, and payment records are excluded. Contributor prompt generation sends only broad fields and opted-in categories. Paid synthesis may process only server-proven paid snapshots.</p>
<h2 class="${H2}">4. Payment and public-chain data</h2>
<p class="${P}">Phantom keeps the user private key. Obolus receives public addresses, signed proofs, and settled transaction data, not seed phrases or exportable keys. The service signer is held in Google Cloud KMS. Pay.sh, the Solana facilitator/RPC, and the public Devnet chain may process or expose wallet addresses, token amounts, signatures, and timestamps. Question text and passage content are not intentionally written on-chain.</p>
<h2 class="${H2}">5. Use of data</h2>
<ul class="${LIST}"><li>Authenticate accounts, protect sessions, and verify payout/prepaid wallet possession</li><li>Build memory, route open calls, rank eligible documents, and prevent redundant purchases</li><li>Deliver paid passages, synthesize citations, settle owners, and recover or refund failed jobs</li><li>Run quality checks, reports, strikes, disputes, security controls, and service audits</li></ul>
<h2 class="${H2}">6. Contributor controls</h2>
<p class="${P}">My Memory allows export, passage locking, corrections, access review, auto-match control, disputes, payout-wallet management, and account deletion. Locking removes a passage from new retrieval and quoting but does not undo an earlier paid delivery or public-chain transaction.</p>
<h2 class="${H2}">7. Deletion and retention</h2>
<p class="${P}">Deleting an account removes profile, documents, memory, active sessions, and matching state from the operational service and starts any required unused-balance payout. Financial and security events required for reconciliation are retained in anonymized append-only form. Public blockchain transactions are immutable. Operational backups and legally required records may expire on separate schedules.</p>
<h2 class="${H2}">8. Processors and security</h2>
<p class="${P}">Google Cloud services may host the application, Vertex AI, KMS, and secrets. Pay.sh and Solana infrastructure process payment requests. Access should be limited by service credentials and IAM, and sensitive responses use no-store controls. No system is risk-free; revoke sessions and contact the service if unauthorized access is suspected.</p>
<h2 class="${H2}">9. Rights, children, and contact</h2>
<p class="${P}">Users may access, correct, export, lock, or delete their information through the service where implemented. People under 14 may not sign up. Privacy requests and incident reports use the Obolus contact channel. Read this policy with the <a class="${LINK}" href="/terms">Terms of Service</a>.</p>
</article>`

export const PRIVACY_HTML_KO = `<article class="${ARTICLE}">
<h1 class="${H1}">개인정보 처리방침</h1>
<p class="${META}">최종 수정: 2026년 8월 9일 · Devnet 지갑 전용 릴리스</p>
<p class="${P}">Obolus는 겪은 일의 기록을 저장합니다. 그 기록이 검색되고 동의에 묶인 사람의 데이터베이스가 되게 하기 위해서입니다. 이 방침은 무엇이 비공개로 남는지, 무엇이 탐색에 드러나는지, 값을 낸 질문자가 무엇을 받는지, 결제 인프라가 무엇을 보는지 밝힙니다.</p>
<h2 class="${H2}">1. 수집하는 정보</h2>
<ul class="${LIST}"><li><strong>계정:</strong> 공개 지갑 주소, 1회용 로그인 챌린지와 서명, 세션과 보안 이벤트, 연령 확인, 역할.</li><li><strong>프로필:</strong> 익명 활동명, 선택한 인구 구간, 분야, 알림 설정, 행동 상태.</li><li><strong>기억:</strong> 질문, 수락된 답변, 비공개 인터뷰 대화, 중요도, 신뢰도, 출처 링크, 정정, 회고, 버전, 잠금, 열람 기록.</li><li><strong>결제:</strong> 결제자·수령자 지갑 주소, 질문·작업 식별자, 금액, mint, 네트워크, 거래 서명, 선불 원장과 정산·환불 상태.</li><li><strong>서비스 활동:</strong> 질문, 필터, 순위 메타데이터, 공개 모집, 예약, 평가, 신고, 이의 신청.</li></ul>
<p class="${P}">계좌나 카드 번호, 시드 구문, 개인 키, 주민등록번호, 다른 사람의 사생활 정보, 정확한 실시간 위치는 올리면 안 됩니다. Obolus에는 그것이 필요 없습니다.</p>
<h2 class="${H2}">2. 탐색과 유료 공개</h2>
<p class="${P}">무료 탐색에는 익명 활동명, 분야, 선택한 인구 구간, 문서 가격, 버전·해시 메타데이터, 순위 구성 요소가 드러날 수 있습니다. 구절 원문, 이메일, 지갑 주소, 비공개 인터뷰 대화는 드러나지 않습니다.</p>
<p class="${P}">맞는 인용의 정산이 끝나면 질문자는 확정된 구절과 인용 표기를 받습니다. 다른 구절, 기억 흐름 전체, 비공개 인터뷰 맥락은 닫힌 채로 남습니다. 이미 전달된 구절은 받은 사람에게서 회수할 수 없습니다.</p>
<h2 class="${H2}">3. AI 처리</h2>
<p class="${P}">사람이 채운 몫이 부족하면 질문만 Vertex AI의 Gemini로 보내 일반 기준선을 만들 수 있습니다. 비공개 데이터베이스의 구절, 신원 정보, 지갑 주소, 결제 기록은 빠집니다. 저자 인터뷰 질문 생성에는 넓은 분야와 직접 고른 항목만 보냅니다. 유료 종합은 서버가 결제를 확인한 스냅숏만 처리합니다.</p>
<h2 class="${H2}">4. 결제와 공개 체인 데이터</h2>
<p class="${P}">개인 키는 Phantom이 갖습니다. Obolus가 받는 것은 공개 주소, 서명된 증명, 정산된 거래 데이터입니다. 시드 구문이나 내보낼 수 있는 키는 받지 않습니다. 서비스 서명자는 Google Cloud KMS에 있습니다. Pay.sh, Solana 퍼실리테이터/RPC, 공개 Devnet 체인은 지갑 주소, 토큰 금액, 서명, 시각을 처리하거나 드러낼 수 있습니다. 질문 문장과 구절 내용은 의도적으로 온체인에 기록하지 않습니다.</p>
<h2 class="${H2}">5. 정보의 이용</h2>
<ul class="${LIST}"><li>계정 인증, 세션 보호, 정산·선불 지갑 소유 확인</li><li>기억 구축, 공개 모집 배분, 조건을 갖춘 문서 순위 산정, 중복 구매 방지</li><li>값을 낸 구절 전달, 인용 종합, 저자 정산, 실패한 작업의 복구와 환불</li><li>품질 검사, 신고, 스트라이크, 이의 신청, 보안 통제, 서비스 감사</li></ul>
<h2 class="${H2}">6. 저자의 통제 수단</h2>
<p class="${P}">내 기억에서 내보내기, 구절 잠금, 정정, 열람 확인, 자동 매칭 설정, 이의 신청, 정산 지갑 관리, 계정 삭제를 할 수 있습니다. 잠그면 구절이 새 검색과 인용에서 빠집니다. 앞서 값을 받고 전달된 구절이나 공개 체인 거래가 되돌려지지는 않습니다.</p>
<h2 class="${H2}">7. 삭제와 보관</h2>
<p class="${P}">계정을 삭제하면 프로필, 문서, 기억, 진행 중인 세션과 매칭 상태가 운영 서비스에서 지워지고, 쓰지 않은 잔액의 정산이 필요하면 시작됩니다. 대사에 필요한 금융·보안 기록은 익명 처리된 추가 전용 형태로 남습니다. 공개 블록체인 거래는 바꿀 수 없습니다. 운영 백업과 법이 요구하는 기록은 각각 다른 일정으로 만료됩니다.</p>
<h2 class="${H2}">8. 수탁자와 보안</h2>
<p class="${P}">Google Cloud 서비스가 애플리케이션, Vertex AI, KMS, 비밀 값을 호스팅할 수 있습니다. Pay.sh와 Solana 인프라가 결제 요청을 처리합니다. 접근은 서비스 자격 증명과 IAM으로 제한하고, 민감한 응답에는 no-store를 적용합니다. 위험이 없는 시스템은 없습니다. 무단 접근이 의심되면 세션을 철회하고 서비스에 알려야 합니다.</p>
<h2 class="${H2}">9. 권리, 아동, 문의</h2>
<p class="${P}">구현된 범위 안에서 서비스를 통해 자기 정보를 열람, 정정, 내보내기, 잠금, 삭제할 수 있습니다. 만 14세 미만은 가입할 수 없습니다. 개인정보 요청과 사고 신고는 Obolus 문의 창구로 받습니다. 이 방침은 <a class="${LINK}" href="/terms">이용약관</a>과 함께 읽어야 합니다.</p>
</article>`

const NOTICE =
  'mx-auto mb-12 max-w-2xl rounded-[6px] border border-[#6D5BD0]/25 bg-[#6D5BD0]/[0.04] px-4 py-4 sm:px-6'
const NOTICE_LABEL =
  'font-mono text-[10px] font-medium uppercase tracking-[1px] text-[#5540BE]'
const NOTICE_BODY = 'mt-2 text-[14px] leading-6 text-foreground/85'

export const AI_LIQUIDITY_PRIVACY_NOTICE_HTML = `<aside class="${NOTICE}"><p class="${NOTICE_LABEL}">AI boundary</p><p class="${NOTICE_BODY}">Gemini supplies general orientation and interview prompts, not human inventory. Free baseline requests exclude private database passages; paid synthesis is restricted to server-proven purchased snapshots. AI output cannot earn, rank as a person, fill a human slot, or become a sellable citation.</p></aside>`

export const AI_LIQUIDITY_PRIVACY_NOTICE_HTML_KO = `<aside class="${NOTICE}"><p class="${NOTICE_LABEL}">AI 경계</p><p class="${NOTICE_BODY}">Gemini는 일반적인 방향과 인터뷰 질문을 내놓습니다. 사람이 쓴 재고가 아닙니다. 무료 기준선 요청에는 비공개 데이터베이스의 구절이 빠집니다. 유료 종합은 서버가 결제를 확인한 스냅숏으로만 제한됩니다. AI 출력은 수익을 얻지 못하고, 사람으로 순위에 오르지 못하고, 사람 자리를 채우지 못하고, 팔리는 인용이 되지 못합니다.</p></aside>`
