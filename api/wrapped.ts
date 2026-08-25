// Bare Vercel functions use the Node runtime by default. Keep this entry off
// Edge and Bun because @resvg/resvg-js loads a native Node binary.
export {
	fetchHandler as DELETE,
	fetchHandler as GET,
	fetchHandler as HEAD,
	fetchHandler as OPTIONS,
	fetchHandler as PATCH,
	fetchHandler as POST,
	fetchHandler as PUT,
} from "../apps/api/src/handler.js";
