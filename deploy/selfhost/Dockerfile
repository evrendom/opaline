# syntax=docker/dockerfile:1
ARG DEBIAN_IMAGE=debian:bookworm-20261104-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

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

FROM bun AS artifact
ARG OPALINE_VERSION=latest
WORKDIR /tmp/artifact
COPY Dockerfile opaline-server-*.tgz* opaline-server-*.json* ./
RUN set -eu; \
	mkdir -p /opt/opaline; \
	tgz="opaline-server-${OPALINE_VERSION}.tgz"; \
	if [ -f "$tgz" ]; then \
		manifest="opaline-server-${OPALINE_VERSION}.json"; \
		[ -f "$manifest" ] || { echo "$tgz needs $manifest next to it" >&2; exit 1; }; \
		sha256="$(sed -n 's/.*"sha256": *"\([0-9a-f]\{64\}\)".*/\1/p' "$manifest")"; \
		[ -n "$sha256" ] || { echo "$manifest has no sha256" >&2; exit 1; }; \
		echo "${sha256}  ${tgz}" | sha256sum -c -; \
		tar -xzf "$tgz" -C /opt/opaline --strip-components=1 --no-same-owner; \
	else \
		echo '{"private":true}' > package.json; \
		bun add --exact "@opalinehq/server@${OPALINE_VERSION}" \
			|| { echo "@opalinehq/server@${OPALINE_VERSION} is not on npm (it is not published yet). Put opaline-server-<version>.tgz and opaline-server-<version>.json from 'bun run build:selfhost' next to this Dockerfile and set OPALINE_VERSION=<version>." >&2; exit 1; }; \
		cp -R node_modules/@opalinehq/server/. /opt/opaline/; \
	fi; \
	test -f /opt/opaline/opaline-server.json; \
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
