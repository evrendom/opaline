import { captureApiServerError } from "./server-error-monitoring.js";

const INTERNAL_PATH_PARAMETER = "__opaline_path";
const ROUTE_CAPTURE_PARAMETERS = ["routePath", "shareId"] as const;

type FetchHandler = (request: Request) => Promise<Response>;

export function createVercelFunctionHandler(input: {
	readonly fetch: FetchHandler;
	readonly functionGroup: string;
	readonly publicPathPattern?: RegExp;
}): FetchHandler {
	return async (request) => {
		const routedRequest = restorePublicRequestPath(
			request,
			input.publicPathPattern,
		);
		if (!routedRequest) {
			return new Response("Not found", { status: 404 });
		}

		try {
			const response = await input.fetch(routedRequest);
			if (response.status >= 500) {
				await captureApiServerError({
					error: new Error(
						`API function returned HTTP ${response.status.toString()}`,
					),
					functionGroup: input.functionGroup,
					request: routedRequest,
					status: response.status,
				});
			}
			return materializeVercelResponse(response, routedRequest.method);
		} catch (error) {
			await captureApiServerError({
				error,
				functionGroup: input.functionGroup,
				request: routedRequest,
			});
			throw error;
		}
	};
}

async function materializeVercelResponse(
	response: Response,
	requestMethod: string,
): Promise<Response> {
	if (requestMethod === "HEAD" || response.body === null) {
		return response;
	}

	// oRPC returns a streamed Fetch Response. Vercel's Bun runtime currently
	// serializes that stream as a successful response with Content-Length: 0.
	// Materializing at the platform boundary preserves the body while leaving the
	// shared Fly/Bun handler unchanged. API responses are already capped upstream.
	const body = await response.arrayBuffer();
	const headers = new Headers(response.headers);
	headers.set("Content-Length", body.byteLength.toString());
	return new Response(body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function restorePublicRequestPath(
	request: Request,
	publicPathPattern: RegExp | undefined,
): Request | null {
	const url = new URL(request.url);
	const publicPath = url.searchParams.get(INTERNAL_PATH_PARAMETER);
	if (!publicPath) {
		return request;
	}
	if (!publicPathPattern?.test(publicPath)) {
		return null;
	}

	url.pathname = publicPath;
	url.searchParams.delete(INTERNAL_PATH_PARAMETER);
	for (const parameter of ROUTE_CAPTURE_PARAMETERS) {
		url.searchParams.delete(parameter);
	}
	return new Request(url.toString(), request);
}
