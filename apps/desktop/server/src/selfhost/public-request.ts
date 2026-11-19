export function atPublicOrigin(
	request: Request,
	publicOrigin: string,
): Request {
	const url = new URL(request.url);
	if (url.origin === publicOrigin) return request;
	return new Request(
		new URL(`${url.pathname}${url.search}`, publicOrigin).href,
		request,
	);
}
