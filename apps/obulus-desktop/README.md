# Obulus Desktop

Obulus Desktop은 구매자와 기여자가 하나의 채팅형 에이전트에서 인간 근거
검색·결제·Open Call·답변·메모리·수익 작업을 수행하는 로컬 보관형
클라이언트입니다. 웹 제품과 동일한 API를 사용하지만 Pay.sh 계정과 서명 키,
Claude API 키, 대화 기록은 사용자의 컴퓨터에 둡니다.

## 웹 버전과 다른 점

기존 웹은 별도 지갑 프로그램을 설치하고 싶지 않은 사용자를 위한 경로입니다.
질문별 한도가 있는 선불 잔액과 Google Cloud KMS 운영 키를 사용합니다. 반면
Desktop은 Obulus 서버에 Phantom 세션이나 서명 권한을 맡기고 싶지 않은
사용자를 위한 선택지입니다. 구매자 검색은 계정 없이 동작합니다. Open Call을
게시하거나 답변·메모리·수익을 관리할 때만 로컬 Pay.sh 지갑의 SIWX 서명으로
wallet-only 세션을 만듭니다.

Desktop이 서버로 보내는 정보는 다음으로 제한됩니다.

- 현재 요청을 처리하기 위해 구성된 Claude endpoint로 전송되는 현재 프롬프트와
  필요한 도구 결과
- 기기에서 직접 식별자를 차단한 질문과 최소 검색 필터
- 사용자가 선택한 공개 근거 핸들과 질문별 단기 접근 권한
- 정산 검증에 필요한 공개 결제 주소와 트랜잭션 영수증
- 사용자가 저장을 명시한 경우에만 기여자 프로필과 알림·재사용 선호

비밀번호, Phantom 세션, seed phrase, private key, Claude API key와 로컬 대화
아카이브는 Obulus 서버로 보내지 않습니다. 도구 결과의 이메일·세션 토큰 같은
비밀 필드는 Claude 입력 전에 제거합니다. 다만 이것은 익명화가 아니라 데이터
최소화와 로컬 키 보관입니다. Solana 주소와 영수증은 공개되고, 검색 서버는
검색에 필요한 질문을 보며, 설정한 Claude endpoint는 현재 프롬프트를 봅니다.

## 세 개로 분리한 MCP 권한

하나의 강한 권한을 가진 MCP 대신 기본적으로 역할이 다른 두 서버를 등록합니다.

1. `obulus`는 계정 없는 검색과 기여자 세션 기반 Open Call·메모리·수익 등
   26개 작업을 제공합니다. 서명 도구는 없습니다.
2. `obulus-pay`는 `pay_approved_intent` 하나만 제공합니다. 모델은 URL, HTTP
   method, 금액, 자산, 네트워크, 수취인을 입력할 수 없습니다. 사용자가 정확한
   일회성 확인 문구를 직접 입력한 로컬 intent만 실행할 수 있습니다.
3. `pay`는 앱에 포함된 공식 Pay.sh MCP입니다. 일반적인 Pay.sh 계정·유료
   리소스 기능을 제공하므로 명시적으로 선택했을 때만 추가합니다. Obulus 근거
   구매에는 더 엄격한 `obulus-pay` 경계를 사용합니다.

Codex와 Claude에는 각 제품의 공식 `mcp add` 명령으로 등록합니다. 같은 이름의
기존 서버가 있으면 조용히 덮어쓰지 않고 그대로 유지합니다.

## 로컬 개발

```bash
cd apps/obulus-desktop
npm install
npm run dev
```

개발 앱은 기본적으로 호스팅된 Obulus API와 x402 gateway를 사용합니다. 다른
주소를 쓰려면 HTTPS origin 또는 loopback URL만 허용됩니다.

```bash
OBULUS_API_URL=http://127.0.0.1:8787 \
OBULUS_GATEWAY_URL=http://127.0.0.1:1402 \
npm run dev
```

## macOS 앱 빌드

```bash
npm run dist:mac
```

빌드할 때 고정된 `@solana/pay@1.0.26` 의존성에서 네이티브 Pay.sh `0.26.0`
바이너리만 복사합니다. SHA-256을 기록하고 패키지 앱이 시작될 때 다시
검증합니다. 바이너리 자체는 Git에 커밋하지 않습니다.

공개 배포 전에는 Apple Developer 배포 인증서, notarization, 재현 가능한 빌드,
안전한 자동 업데이트가 추가로 필요합니다. 현재 로컬 결과물은 개발 인증서로
서명한 검증용 빌드이지 공개 릴리스가 아닙니다.

## 처음 실행할 때

1. Obulus Desktop을 엽니다.
2. **OS 보안 계정 만들기**를 선택합니다. macOS는 Keychain, Windows는 Windows
   Hello, Linux는 GNOME Keyring에 키를 보관합니다. 평문 파일로 자동
   전환하지 않습니다.
3. Obulus 견적에 표시된 네트워크의 결제 자산을 계정에 입금합니다.
4. 인간 근거 메타데이터를 무료로 검색합니다.
5. 필요한 문서만 선택하고 정확한 일회성 결제 조건을 확인한 뒤 확인 문구를
   직접 입력합니다.
6. 필요하면 Codex 또는 Claude 설치 버튼으로 제한된 두 MCP를 등록합니다.
   공식 범용 Pay MCP는 설정에서 별도로 선택합니다.

현재 Obulus 마켓은 Devnet 전용입니다. Mainnet 자금 운용, 규제 준수, 운영 RPC
정책, notarized 앱 배포는 상용화 전에 반드시 통과해야 할 단계입니다.
