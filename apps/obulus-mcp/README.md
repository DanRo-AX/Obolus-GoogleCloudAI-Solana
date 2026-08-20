# Obulus Full MCP

Obulus 웹과 기존 Antigravity 플러그인에 흩어져 있던 구매자·기여자·메모리·결제·복구 기능을 하나의 stdio MCP 서버로 제공합니다. Node.js 20.18 이상만 필요하며 서버 자체에는 외부 npm 의존성이 없습니다.

## 제공 범위

- 질문 해석, 사람 DB 검색, Personalized PageRank 결과와 가격 비교
- 무료 Gemini 기준선과 출처·라이선스·해시가 있는 공인 공개 데이터 검색
- 선택 문서의 온체인 사전 청구서와 Pay.sh/x402 정확 결제 준비
- 결제 진행 확인, 중복 결제 방지, 구매한 passage와 Solana 영수증 복구
- 답변 합성, 문서 평가, Open Call 생성·조회·취소
- 기여 기회·예약·답변·starter 관리
- 프로필·선호·메모리·알림·수익·payout claim·계정 데이터 관리
- 선불 잔액 확인과 명시적 확인 문구가 필요한 출금

총 30개 도구입니다. 목록은 다음 명령으로 확인합니다.

```bash
cd apps/obulus-mcp
npm run tools
```

## 설치

로컬 API를 실행한 개발 환경의 기본값은 `127.0.0.1:8787`과 `127.0.0.1:1402`입니다. 배포 환경에서는 HTTPS origin을 지정해야 합니다.

```bash
cd apps/obulus-mcp
export OBULUS_API_URL=https://api.example.com
export OBULUS_GATEWAY_URL=https://pay.example.com
node src/cli.mjs install-mcp --client all
```

`--client`는 `codex`, `claude`, `gemini`, `all` 중 하나입니다. 기존 개인정보 최소화용 `obulus` MCP를 덮어쓰지 않도록 이 서버는 `obulus-full`이라는 이름으로 등록됩니다. 각 클라이언트는 `codex-mcp`, `claude-mcp`, `gemini-mcp`라는 비식별 실행 출처를 API에 보내므로 Admin 데이터 플레인에서 기기별 처리 경로와 지연시간을 확인할 수 있습니다. 질문, 답변, 지갑 주소는 이 운영 이벤트에 포함되지 않습니다.

Gemini CLI만 등록하려면 다음을 실행합니다.

```bash
node src/cli.mjs install-mcp --client gemini
```

무료 검색과 결제 후보·청구서 조회에는 로그인이 필요하지 않습니다. 기여자·메모리·수익처럼 개인 계정이 필요한 작업만 MCP의 `connect_wallet`을 호출합니다. 이 도구는 로컬 Pay.sh 지갑으로 무료 SIWX 소유권 서명만 수행하며 USDC를 사용하지 않고 개인키를 내보내지 않습니다. 관리형 서버의 이메일/비밀번호 인증은 비활성화되어 있습니다.

```bash
node src/cli.mjs auth status
node src/cli.mjs doctor
```

세션과 질문별 결제 capability는 기본적으로 `~/.config/obulus/mcp-session.json`에 `0600` 권한으로 저장됩니다. 여러 계정을 분리하려면 `OBULUS_MCP_PROFILE=work`처럼 설정합니다.

## 결제 경계

이 MCP는 결제를 직접 서명하지 않습니다.

1. `ask_people`로 무료 메타데이터와 후보를 검색합니다.
2. `preview_settlement_invoice`로 문서 묶음·소유자 몫·프로토콜 수수료·네트워크·자산을 확인합니다.
3. `prepare_evidence_payment`가 Rust 원장과 gateway 견적을 대조한 정확한 Devnet URL과 금액을 반환합니다.
4. 사용자에게 금액과 목적을 보여주고 명시적으로 확인받은 뒤에만 별도의 공식 Pay MCP `curl` 도구를 호출합니다.
5. 재시도 전에는 `payment_progress` 또는 `evidence_payment_status`로 기존 정산을 복구합니다.

따라서 모델은 임의 URL, 임의 금액, Phantom 개인키, Pay.sh 계정 비밀을 받지 않습니다. 공식 Pay MCP는 Pay.sh 설치 후 해당 도구의 `pay mcp` 명령을 별도 등록해야 합니다.

## 직접 호출과 테스트

```bash
node src/cli.mjs call search_public_evidence --json '{"query":"consumer preference","limit":5}'
npm test
```

## 환경 변수

| 변수 | 용도 |
|---|---|
| `OBULUS_API_URL` | Rust API origin; 원격 주소는 HTTPS 필수 |
| `OBULUS_GATEWAY_URL` | x402/Pay.sh gateway origin; 원격 주소는 HTTPS 필수 |
| `OBULUS_MCP_STATE` | 암호화 키가 아닌 로컬 세션/capability 파일 경로 |
| `OBULUS_MCP_PROFILE` | 분리된 상태 파일 이름에 쓰는 프로필 |
이메일, 비밀번호, 시드 문구 또는 개인키를 MCP 환경 변수에 등록하지 마세요.
