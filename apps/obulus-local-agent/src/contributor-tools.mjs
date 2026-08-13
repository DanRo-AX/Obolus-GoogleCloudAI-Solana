const object = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const string = (description, extra = {}) => ({ type: 'string', description, ...extra })
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const boolean = (description) => ({ type: 'boolean', description })
const stringArray = (description, item = {}) => ({
  type: 'array',
  description,
  items: { type: 'string', ...item },
})

const categories = [
  'life', 'food', 'family', 'health', 'business', 'sales', 'engineering',
  'education', 'sports', 'travel', 'money',
]
const filters = object({
  category: string('경험 카테고리.', { enum: categories }),
  maxUnitPriceKrw: integer('기존 문서 한 건의 최대 가격.', { minimum: 1 }),
  ageBand: string('연령 구간.', { enum: ['under-25', '25-34', '35-44', '45-54', '55-plus'] }),
  region: string('지역 구간.', { enum: ['seoul', 'gyeonggi', 'metro', 'town', 'abroad'] }),
  household: string('가구 형태.', { enum: ['alone', 'partner', 'kids', 'parents', 'shared'] }),
  field: string('경험 분야.', { enum: categories }),
})

export const contributorTools = [
  {
    name: 'account_status',
    description: '로컬 Pay.sh 지갑으로 연결된 Obulus 계정과 잔액을 확인합니다.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'prepare_open_call',
    description:
      '기존 근거가 부족할 때 실제 사람에게 답변을 요청할 Open Call과 정확한 Devnet 에스크로 결제 의도를 준비합니다. 결제를 실행하지 않습니다.',
    inputSchema: object(
      {
        question: string('사람들이 답할 구체적인 질문.', { minLength: 8, maxLength: 1_000 }),
        unitPriceKrw: integer('채택 답변 한 건의 보상.', { minimum: 1, maximum: 1_000_000 }),
        target: integer('필요한 답변 수.', { minimum: 1, maximum: 100 }),
        chatId: string('답변을 받을 대화 id.', { maxLength: 128 }),
        shelf: string('대상 집단 이름.', { minLength: 2, maxLength: 120 }),
        category: string('질문 카테고리.', { enum: categories }),
        filters,
      },
      ['question', 'unitPriceKrw', 'target', 'shelf', 'category'],
    ),
  },
  {
    name: 'open_call_status',
    description: 'Open Call 자금 조달 상태와 도착한 인간 답변을 확인합니다.',
    inputSchema: object({
      quoteId: string('자금 조달 quote id.'),
      chatId: string('답변을 받을 대화 id.'),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'cancel_open_call',
    description: '소유한 Open Call을 취소하고 미사용 금액의 환불 절차를 시작합니다.',
    inputSchema: object(
      {
        openCallId: string('취소할 Open Call id.'),
        confirmation: string('정확히 CANCEL OPEN CALL <id> 형식의 사용자 확인.'),
      },
      ['openCallId', 'confirmation'],
    ),
    annotations: { destructiveHint: true },
  },
  {
    name: 'submit_document_feedback',
    description: '실제로 결제해 연 인간 근거를 평가하거나 신고합니다.',
    inputSchema: object(
      {
        queryId: string('원 질문 id.'),
        handle: string('결제한 문서 handle.'),
        payer: string('정산에 사용한 공개 Solana payer 주소.'),
        outcome: string('평가.', { enum: ['helpful', 'not_helpful', 'report'] }),
        reason: string('신고 사유 또는 선택적 의견.', { maxLength: 1_000 }),
      },
      ['queryId', 'handle', 'payer', 'outcome'],
    ),
  },
  {
    name: 'get_profile',
    description: '연결된 기여자 프로필, 선호 설정, 지급 지갑 상태를 확인합니다.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'update_profile',
    description: '기여자 프로필을 저장합니다. 사용자가 직접 제공하지 않은 개인정보를 추론하지 마세요.',
    inputSchema: object(
      {
        handle: string('공개 익명 handle.', { minLength: 3, maxLength: 32 }),
        ageBand: string('연령 구간.', { enum: ['under-25', '25-34', '35-44', '45-54', '55-plus'] }),
        region: string('지역 구간.', { enum: ['seoul', 'gyeonggi', 'metro', 'town', 'abroad'] }),
        household: string('가구 형태.', { enum: ['alone', 'partner', 'kids', 'parents', 'shared'] }),
        field: string('주 경험 분야.', { enum: categories }),
        years: string('경험 기간.', { enum: ['under-1', '1-3', '3-7', '7-plus'] }),
        speaksTo: stringArray('답할 수 있는 카테고리.', { enum: categories }),
        autoMatch: boolean('검증된 과거 답변의 엄격한 자동 재사용 허용.'),
        agents: boolean('에이전트의 질문 전달 허용.'),
        browserAlerts: boolean('앱 알림 허용.'),
        emailAlerts: boolean('이메일 알림 허용.'),
      },
      ['handle', 'ageBand', 'region', 'household', 'field', 'years', 'speaksTo', 'autoMatch', 'agents'],
    ),
  },
  {
    name: 'prepare_payout_wallet_link',
    description: 'Pay.sh 로컬 지갑을 기여자 지급 지갑으로 증명하는 1회 SIWX 링크를 준비합니다. USDC를 사용하지 않습니다.',
    inputSchema: object(),
  },
  {
    name: 'update_preferences',
    description: '자동 매칭과 알림 설정을 변경합니다.',
    inputSchema: object({
      autoMatch: boolean('과거 원문 답변의 엄격한 자동 재사용.'),
      agents: boolean('에이전트 질문 전달.'),
      browserAlerts: boolean('앱 알림.'),
      emailAlerts: boolean('이메일 알림.'),
    }),
  },
  {
    name: 'list_opportunities',
    description: '현재 참여 가능한 유료 질문과 적합성 신호를 조회합니다.',
    inputSchema: object({ eligibleOnly: boolean('현재 사용자에게 적합한 공고만 표시.') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'manage_reservation',
    description: '답변을 쓰기 전에 Open Call 한 자리를 예약하거나 해제합니다.',
    inputSchema: object(
      {
        action: string('reserve 또는 release.', { enum: ['reserve', 'release'] }),
        openCallId: string('Open Call id.'),
      },
      ['action', 'openCallId'],
    ),
  },
  {
    name: 'submit_human_answer',
    description: '사용자가 직접 작성한 실제 경험 답변을 제출합니다. AI가 대신 쓰거나 다듬어 실제 경험인 것처럼 제출하면 안 됩니다.',
    inputSchema: object(
      {
        openCallId: string('예약한 Open Call id.'),
        answer: string('사용자가 직접 작성한 최종 답변.', { minLength: 10, maxLength: 10_000 }),
        interviewResponses: {
          type: 'array',
          items: object(
            {
              questionId: string('후속 질문 id.'),
              prompt: string('후속 질문.'),
              answer: string('사용자가 직접 작성한 답변.'),
            },
            ['questionId', 'prompt', 'answer'],
          ),
        },
        humanAuthoredConfirmation: string('정확히 I WROTE THIS EXPERIENCE 형식의 사용자 확인.'),
      },
      ['openCallId', 'answer', 'humanAuthoredConfirmation'],
    ),
  },
  {
    name: 'shelf_starters',
    description: '기여자의 실제 기억을 구체화하는 무료 인터뷰 질문을 조회하거나 생성합니다. AI가 답을 대신 만들지 않습니다.',
    inputSchema: object({ action: string('list 또는 generate.', { enum: ['list', 'generate'] }) }, ['action']),
  },
  {
    name: 'answer_shelf_starter',
    description: '사용자가 직접 작성한 starter 답변을 판매 가능한 인간 경험 문서로 만듭니다.',
    inputSchema: object(
      {
        starterId: string('Starter id.'),
        answer: string('사용자가 직접 작성한 경험.', { minLength: 10, maxLength: 10_000 }),
        priceKrw: integer('향후 1회 열람 가격.', { enum: [5, 10, 15, 25, 100, 300, 500, 700, 800, 1_000] }),
        humanAuthoredConfirmation: string('정확히 I WROTE THIS EXPERIENCE 형식의 사용자 확인.'),
      },
      ['starterId', 'answer', 'priceKrw', 'humanAuthoredConfirmation'],
    ),
  },
  {
    name: 'notifications',
    description: '기여자 알림을 조회하거나 읽음 처리합니다.',
    inputSchema: object(
      {
        action: string('list 또는 mark_read.', { enum: ['list', 'mark_read'] }),
        ids: stringArray('읽음 처리할 알림 id. 빈 배열이면 모두.'),
      },
      ['action'],
    ),
  },
  {
    name: 'manage_memory',
    description: '내 인간 경험 메모리를 조회·잠금·정정·이의 제기합니다. 정정 답변은 사용자가 직접 작성해야 합니다.',
    inputSchema: object(
      {
        action: string('list, lock, correct, dispute.', { enum: ['list', 'lock', 'correct', 'dispute'] }),
        memoryId: string('list 이외 작업의 memory id.'),
        locked: boolean('lock 작업의 상태.'),
        answer: string('사용자가 직접 작성한 정정 답변.', { maxLength: 10_000 }),
        reason: string('이의 제기 사유.', { maxLength: 1_000 }),
        humanAuthoredConfirmation: string('정정 시 정확히 I WROTE THIS EXPERIENCE.'),
      },
      ['action'],
    ),
  },
  {
    name: 'earnings_and_claims',
    description: '기여 수익, 보류액, 청구 가능액과 온체인 지급 상태를 확인합니다.',
    inputSchema: object(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'account_data',
    description: '계정 잔액 조회, 데이터 내보내기 또는 영구 삭제를 수행합니다.',
    inputSchema: object(
      {
        action: string('balance, export, delete.', { enum: ['balance', 'export', 'delete'] }),
        confirmation: string('삭제 시 정확히 DELETE MY OBULUS ACCOUNT.'),
      },
      ['action'],
    ),
    annotations: { destructiveHint: true },
  },
  {
    name: 'lookup_contributor',
    description: '공개 기여자 manifest와 판매 가능한 인간 경험 링크를 조회합니다.',
    inputSchema: object({ handle: string('공개 contributor handle.') }, ['handle']),
    annotations: { readOnlyHint: true },
  },
]
