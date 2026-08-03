FROM rust:1.89-bookworm AS builder
ENV RUSTUP_TOOLCHAIN=1.97.1

# @solana/pay@1.0.26 installs pay v0.26.0. The published convenience binary
# omits gcp_kms, so Cloud Run must compile the official CLI with that feature.
ARG PAY_COMMIT=2da31c3b0e53805f9a9a9f7cc41cd16253c02810
RUN apt-get update \
    && apt-get install --yes --no-install-recommends git cmake clang pkg-config libssl-dev \
    && git init /src/pay \
    && git -C /src/pay remote add origin https://github.com/solana-foundation/pay.git \
    && git -C /src/pay fetch --depth 1 origin ${PAY_COMMIT} \
    && git -C /src/pay checkout --detach FETCH_HEAD
WORKDIR /src/pay/rust
# The production API does not expose the optional payment-debugger web UI.
RUN PAY_PDB_ALLOW_PLACEHOLDER=1 \
    cargo build --locked --release --package pay --features gcp_kms

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/pay/rust/target/release/pay /usr/local/bin/pay
WORKDIR /app
COPY pay/paywall.gcloud.yml /app/paywall.yml
COPY backend/openapi.json /app/openapi.json

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "pay gate api /app/paywall.yml --bind 0.0.0.0:${PORT:-8080} --openapi /app/openapi.json --no-register"]
