import { renderModelPricingTable } from "../packages/api-routes/src/model-pricing.js";

const output = renderModelPricingTable();
const outputPath = new URL("../docs/model-pricing.md", import.meta.url);

await Bun.write(outputPath, output);
console.log(output);
