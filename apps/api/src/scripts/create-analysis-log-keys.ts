import { createSigningKeys } from "../services/analysis-log/convex-token.js";

// Prints a new key pair: the private key for the API's environment and the
// public key set for the Convex deployment (the hosted service's Convex functions).
const { signingKey, jwks } = await createSigningKeys();
console.log(`ANALYSIS_LOG_SIGNING_KEY='${JSON.stringify(signingKey)}'`);
console.log(`ANALYSIS_LOG_JWKS='${jwks}'`);
