# syntax=docker/dockerfile:1
ARG DEBIAN_IMAGE=debian:bookworm-20261104-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG BUILD_BUN_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

FROM ${DEBIAN_IMAGE} AS bun
ARG TARGETARCH
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl unzip \
	&& rm -rf /var/lib/apt/lists/*
# Bun releases after 1.3.8 crash with SIGILL on x86-64 CPUs without AVX2 (most NAS Celerons), baseline builds included; 1.3.8 baseline needs only SSE4.2.
RUN set -eu; \
	arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
	case "$arch" in \
		amd64) asset=bun-linux-x64-baseline; sha256=bbe4632ac03d7495177d542ecefa8f21f9849273106525f6bb13172ec8e4ab2c ;; \
		arm64) asset=bun-linux-aarch64; sha256=4e9deb6814a7ec7f68725ddd97d0d7b4065bcda9a850f69d497567e995a7fa33 ;; \
		*) echo "Opaline images run on amd64 and arm64, not $arch" >&2; exit 1 ;; \
	esac; \
	curl -fsSL --retry 3 -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v1.3.8/${asset}.zip"; \
	echo "${sha256}  /tmp/bun.zip" | sha256sum -c -; \
	unzip -q /tmp/bun.zip -d /tmp; \
	install -m 0755 "/tmp/${asset}/bun" /usr/local/bin/bun; \
	rm -rf /tmp/bun.zip "/tmp/${asset}"; \
	bun --version

FROM ${BUILD_BUN_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN set -eu; \
	mkdir -p /manifests; \
	find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} /manifests \; ; \
	cp --parents bun.lock /manifests; \
	cp -R --parents patches /manifests

FROM ${BUILD_BUN_IMAGE} AS artifact
ARG OPALINE_VERSION=0.0.0-source
WORKDIR /src
COPY --from=manifests /manifests ./
RUN bun install --frozen-lockfile
COPY . .
RUN set -eu; \
	bun run build:selfhost --version "${OPALINE_VERSION}" --out /tmp/dist; \
	mkdir -p /opt/opaline; \
	tar -xzf "/tmp/dist/opaline-server-${OPALINE_VERSION}.tgz" -C /opt/opaline --strip-components=1 --no-same-owner; \
	test -f /opt/opaline/server/main.js

FROM ${DEBIAN_IMAGE} AS runtime
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --uid 10001 --user-group --home-dir /var/lib/opaline --create-home --shell /usr/sbin/nologin opaline
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=artifact /opt/opaline /opt/opaline
ENV OPALINE_SELF_HOSTED=1 \
	HOST=0.0.0.0 \
	PORT=4100 \
	OPALINE_DATA_DIR=/var/lib/opaline \
	NODE_ENV=production
USER opaline
WORKDIR /var/lib/opaline
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=4 \
	CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health/ready`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["bun", "--no-install", "/opt/opaline/server/main.js"]
