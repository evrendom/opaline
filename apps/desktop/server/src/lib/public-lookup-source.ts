export function resolvePublicLookupSource(input: {
	forwardedFor: string | null;
	socketIp: string | null;
	trustedProxyHops: number;
}): string {
	const peerIp = input.socketIp?.trim() || null;

	const forwardedIps =
		input.forwardedFor
			?.split(",")
			.map((ip) => ip.trim())
			.filter(Boolean) ?? [];

	if (peerIp && forwardedIps.at(-1) !== peerIp) {
		forwardedIps.push(peerIp);
	}

	// A socket peer is appended to the chain above; a Web-standard runtime
	// has no socket peer, so its X-Forwarded-For chain has no extra slot to skip.
	const peerOffset = peerIp ? 1 : 0;
	const sourceIndex = forwardedIps.length - input.trustedProxyHops - peerOffset;
	return (
		forwardedIps[sourceIndex] ?? peerIp ?? forwardedIps.at(-1) ?? "unknown"
	);
}
