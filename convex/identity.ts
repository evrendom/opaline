/**
 * The token claims of Opaline's API. Only tokens it signs with the private
 * half of `ANALYSIS_LOG_JWKS` carry them (see README). The API repeats these
 * values in apps/api/src/services/analysis-log/convex-token.ts.
 */
export const API_ISSUER = "https://opaline.so/analysis-log";
export const API_AUDIENCE = "opaline-analysis-log";
