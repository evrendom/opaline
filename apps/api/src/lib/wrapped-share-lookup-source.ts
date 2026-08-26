export function resolveWrappedShareLookupSource(input: {
	flyClientIp: string | null;
	forwardedFor: string | null;
	socketIp: string | null;
	trustedProxyHops: number;
}): string {
	const flyClientIp = input.flyClientIp?.trim() || null;
	const socketIp = input.socketIp?.trim() || null;
	const peerIp = flyClientIp ?? socketIp;

	const forwardedIps =
		input.forwardedFor
			?.split(",")
			.map((ip) => ip.trim())
			.filter(Boolean) ?? [];

	if (flyClientIp && forwardedIps.length > 0) {
		// Fly appends the app's public IP to X-Forwarded-For. Replace it with
		// Fly-Client-IP so the remaining chain matches a conventional proxy chain.
		forwardedIps.pop();
	}

	if (peerIp && forwardedIps.at(-1) !== peerIp) {
		forwardedIps.push(peerIp);
	}

	// A socket/Fly peer is appended to the chain above; a Web-standard runtime
	// has no socket peer, so its X-Forwarded-For chain has no extra slot to skip.
	const peerOffset = peerIp ? 1 : 0;
	const sourceIndex = forwardedIps.length - input.trustedProxyHops - peerOffset;
	return (
		forwardedIps[sourceIndex] ?? peerIp ?? forwardedIps.at(-1) ?? "unknown"
	);
}
