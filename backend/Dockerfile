FROM rust:1.89-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 openshelf \
    && mkdir -p /data \
    && chown openshelf:openshelf /data
COPY --from=builder /app/target/release/openshelf-api /usr/local/bin/openshelf-api
WORKDIR /data
USER openshelf
ENV OPENSHELF_BIND=0.0.0.0:8787
ENV OPENSHELF_DATABASE=/data/openshelf.db
VOLUME ["/data"]
EXPOSE 8787
CMD ["openshelf-api"]
