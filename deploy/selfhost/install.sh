#!/bin/sh
set -eu
umask 077

usage() {
	cat <<'EOF'
Usage: ./install.sh [options]

Starts Opaline (server, Postgres, ClickHouse) with Docker Compose, waits until it
is healthy and prints the owner's sign-in link and the command for teammates.
Run it again at any time: secrets in .env are kept and you get a fresh link.

  --email EMAIL        the owner's email (asked when missing)
  --name NAME          the owner's name (default: the part of the email before @)
  --workspace NAME     the workspace name (default: Opaline)
  --public-url URL     how browsers and the CLI reach Opaline
                       (default: http://<this machine's LAN address>:<port>)
  --port PORT          host port for Opaline (default: 4100)
  --domain NAME        serve https://NAME through Caddy (DNS for NAME must point
                       here, ports 80 and 443 must be reachable)
  --version X.Y.Z      build this @opalinehq/server version
  --upgrade            build the newest @opalinehq/server version
  --artifact FILE      build from a local opaline-server-<version>.tgz (its .json
                       manifest must sit next to it)
  --clickhouse-only    run only ClickHouse here, reachable on the LAN, for an
                       Opaline server on a laptop (opaline server --clickhouse-url)
  -h, --help           show this help
EOF
}

die() {
	printf 'install.sh: %s\n' "$*" >&2
	exit 1
}

value() {
	[ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"
	printf '%s' "$2"
}

email=
name=
workspace=
public_url=
port=
domain=
version=
upgrade=
artifact=
clickhouse_only=
while [ $# -gt 0 ]; do
	case "$1" in
	--email) email=$(value "$@"); shift 2 ;;
	--name) name=$(value "$@"); shift 2 ;;
	--workspace) workspace=$(value "$@"); shift 2 ;;
	--public-url) public_url=$(value "$@"); shift 2 ;;
	--port) port=$(value "$@"); shift 2 ;;
	--domain) domain=$(value "$@"); shift 2 ;;
	--version) version=$(value "$@"); shift 2 ;;
	--upgrade) upgrade=1; shift ;;
	--artifact) artifact=$(value "$@"); shift 2 ;;
	--clickhouse-only) clickhouse_only=1; shift ;;
	-h | --help) usage; exit 0 ;;
	*) die "unknown option $1 (see --help)" ;;
	esac
done

case "$port" in
'' | *[!0-9]*) [ -z "$port" ] || die "--port must be a number" ;;
esac
[ -z "$domain" ] || [ -z "$clickhouse_only" ] || die "--domain and --clickhouse-only exclude each other"
[ -z "$artifact" ] || [ -f "$artifact" ] || die "no such file: $artifact"
case "$artifact" in
'' | *.tgz) ;;
*) die "--artifact takes the .tgz file" ;;
esac

if [ -n "$artifact" ]; then
	artifact=$(cd "$(dirname "$artifact")" && pwd)/$(basename "$artifact")
fi
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || die "Docker is not installed"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the 'docker compose' command)"
docker info >/dev/null 2>&1 || die "cannot talk to Docker; run as a user in the docker group, or with sudo"

env_get() {
	[ -f .env ] || return 0
	sed -n "s/^$1=//p" .env | tail -n 1
}

env_set() {
	KEY=$1 VALUE=$2 awk '
		BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
		index($0, key "=") == 1 { print key "=" value; done = 1; next }
		{ print }
		END { if (!done) print key "=" value }
	' .env >.env.tmp
	mv .env.tmp .env
}

secret() {
	if command -v openssl >/dev/null 2>&1; then
		openssl rand -hex 32
	else
		od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
	fi
}

lan_address() {
	address=$(hostname -I 2>/dev/null | awk '{ print $1 }') || address=
	if [ -z "$address" ]; then
		address=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }') || address=
	fi
	[ -n "$address" ] || address=$(ipconfig getifaddr en0 2>/dev/null) || address=
	[ -n "$address" ] || address=$(hostname)
	printf '%s' "$address"
}

newest_version() {
	url=https://registry.npmjs.org/@opalinehq%2fserver/latest
	if command -v curl >/dev/null 2>&1; then
		body=$(curl -fsSL "$url" 2>/dev/null) || body=
	else
		body=$(wget -qO- "$url" 2>/dev/null) || body=
	fi
	printf '%s' "$body" | tr ',' '\n' | sed -n 's/^.*"version": *"\([^"]*\)".*$/\1/p' | head -n 1
}

first_run=
if [ ! -f .env ]; then
	first_run=1
	cp .env.example .env
fi
chmod 600 .env

for key in POSTGRES_PASSWORD CLICKHOUSE_PASSWORD BETTER_AUTH_SECRET OPALINE_SETUP_TOKEN; do
	[ -n "$(env_get "$key")" ] || env_set "$key" "$(secret)"
done

if [ -n "$clickhouse_only" ]; then
	env_set COMPOSE_PROFILES ""
	env_set CLICKHOUSE_BIND 0.0.0.0
elif [ -n "$domain" ]; then
	env_set COMPOSE_PROFILES server,https
	env_set OPALINE_DOMAIN "$domain"
	env_set OPALINE_PUBLIC_URL "https://$domain"
	env_set OPALINE_BIND 127.0.0.1
else
	case ",$(env_get COMPOSE_PROFILES)," in
	*,server,*) ;;
	*)
		env_set COMPOSE_PROFILES server
		env_set CLICKHOUSE_BIND 127.0.0.1
		;;
	esac
fi
[ -z "$port" ] || env_set OPALINE_PORT "$port"
if [ -n "$public_url" ]; then
	env_set OPALINE_PUBLIC_URL "${public_url%/}"
elif [ -z "$domain" ] && [ -n "$first_run" ]; then
	env_set OPALINE_PUBLIC_URL "http://$(lan_address):$(env_get OPALINE_PORT)"
elif [ -z "$domain" ] && [ -n "$port" ]; then
	host=$(env_get OPALINE_PUBLIC_URL | sed -n 's|^http://\([^:/]*\).*|\1|p')
	[ -n "$host" ] || die "--port with an https public URL needs --public-url too"
	env_set OPALINE_PUBLIC_URL "http://$host:$port"
fi

case ",$(env_get COMPOSE_PROFILES)," in
*,server,*) server=1 ;;
*) server= ;;
esac

if [ -n "$server" ]; then
	if [ -n "$artifact" ]; then
		manifest=${artifact%.tgz}.json
		[ -f "$manifest" ] || die "$artifact needs its manifest $manifest next to it"
		version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)
		[ -n "$version" ] || die "$manifest has no version"
		[ "$(basename "$artifact")" = "opaline-server-$version.tgz" ] || die "$artifact should be named opaline-server-$version.tgz"
		if [ "$artifact" != "$(pwd)/opaline-server-$version.tgz" ]; then
			cp "$artifact" "opaline-server-$version.tgz"
			cp "$manifest" "opaline-server-$version.json"
		fi
	elif [ -z "$version" ] && { [ -n "$upgrade" ] || [ -z "$(env_get OPALINE_VERSION)" ]; }; then
		version=$(newest_version)
		[ -n "$version" ] || die "@opalinehq/server is not on npm yet. Build it in an athena checkout with 'bun run build:selfhost --version <x.y.z>' and pass --artifact dist-selfhost/opaline-server-<x.y.z>.tgz"
	fi
	[ -z "$version" ] || env_set OPALINE_VERSION "$version"

	email=${email:-$(env_get OPALINE_OWNER_EMAIL)}
	if [ -z "$email" ]; then
		[ -t 0 ] || die "pass --email for the owner's account"
		printf 'Email of the owner account: '
		read -r email
	fi
	case "$email" in
	*@*) ;;
	*) die "not an email address: $email" ;;
	esac
	env_set OPALINE_OWNER_EMAIL "$email"
fi

if [ -n "$server" ]; then
	printf 'Building and starting Opaline %s ...\n' "$(env_get OPALINE_VERSION)"
	docker compose up -d --build
else
	printf 'Starting ClickHouse ...\n'
	docker compose up -d
fi

wait_healthy() {
	deadline=$(($(date +%s) + $2))
	while :; do
		id=$(docker compose ps -q "$1" 2>/dev/null) || id=
		state=
		if [ -n "$id" ]; then
			state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null) || state=
		fi
		[ "$state" != healthy ] || return 0
		if [ "$(date +%s)" -ge "$deadline" ]; then
			docker compose logs --tail 40 "$1" >&2 || true
			die "$1 is not healthy after $2 seconds (state: ${state:-not running})"
		fi
		sleep 3
	done
}

wait_healthy clickhouse 180

if [ -z "$server" ]; then
	address=$(lan_address)
	cat <<EOF

ClickHouse is running on http://$address:$(env_get CLICKHOUSE_HTTP_PORT) (user opaline).
Start Opaline on your laptop with it:

  OPALINE_CLICKHOUSE_PASSWORD=$(env_get CLICKHOUSE_PASSWORD) npx opaline@latest server --clickhouse-url http://$address:$(env_get CLICKHOUSE_HTTP_PORT) --clickhouse-user opaline

The password is CLICKHOUSE_PASSWORD in $(pwd)/.env. ClickHouse speaks plain HTTP: keep it on your LAN.
EOF
	exit 0
fi

wait_healthy opaline 600

name=${name:-${email%%@*}}
workspace=${workspace:-Opaline}
login_url=$(docker compose exec -T -e OWNER_EMAIL="$email" -e OWNER_NAME="$name" -e WORKSPACE_NAME="$workspace" opaline bun -e '
const response = await fetch(`http://127.0.0.1:${process.env.PORT}/api/selfhost/setup`, {
	method: "POST",
	headers: { "content-type": "application/json", "x-opaline-setup-token": process.env.OPALINE_SETUP_TOKEN },
	body: JSON.stringify({ email: process.env.OWNER_EMAIL, name: process.env.OWNER_NAME, workspaceName: process.env.WORKSPACE_NAME }),
});
const body = await response.json().catch(() => ({}));
if (response.status === 409) {
	console.error("this server already has an owner with another email; pass that email with --email");
	process.exit(1);
}
if (!response.ok || !body.loginUrl) {
	console.error(`setup answered ${response.status}: ${JSON.stringify(body)}`);
	process.exit(1);
}
console.log(body.loginUrl);
') || die "could not create the owner account"

url=$(env_get OPALINE_PUBLIC_URL)
case "$url" in
http://localhost* | http://127.0.0.1*) insecure= ;;
http://*) insecure=" --allow-insecure-api-base" ;;
*) insecure= ;;
esac
cat <<EOF

Opaline $(env_get OPALINE_VERSION) is running at $url

Sign in as $email with this one-time link (valid for 10 minutes):
  $login_url

Connect Claude Code and Codex on each computer (yours and your teammates'):
  npx opaline@latest login --server $url$insecure

Teammates join from Settings > Members in the dashboard. Run ./install.sh again for a new sign-in link.
EOF
case ",$(env_get COMPOSE_PROFILES)," in
*,https,*) printf '\nCaddy gets the certificate for %s on the first request; give it a minute.\n' "$(env_get OPALINE_DOMAIN)" ;;
esac
