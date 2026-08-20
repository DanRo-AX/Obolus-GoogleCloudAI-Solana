FROM rust:1.89-bookworm@sha256:948f9b08a66e7fe01b03a98ef1c7568292e07ec2e4fe90d88c07bb14563c84ff AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY data ./data
RUN cargo build --locked --release

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 openshelf \
    && mkdir -p /data \
    && chown openshelf:openshelf /data
COPY --from=builder /app/target/release/openshelf-api /usr/local/bin/openshelf-api
WORKDIR /data
USER openshelf
ENV OPENSHELF_ENV=production
ENV OPENSHELF_BIND=0.0.0.0:8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["openshelf-api"]
