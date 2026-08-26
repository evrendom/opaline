// Hobby is intentionally capped at 2 GB / 300 s. At the launch-week Pro
// flip, this group can move to the planned 4 GB / 800 s without changing the
// shared request handler.
export {
	fetchHandler as DELETE,
	fetchHandler as GET,
	fetchHandler as HEAD,
	fetchHandler as OPTIONS,
	fetchHandler as PATCH,
	fetchHandler as POST,
	fetchHandler as PUT,
} from "../apps/api/src/handler.js";
