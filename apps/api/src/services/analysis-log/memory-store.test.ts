import { createMemoryAnalysisStore } from "./memory-store.js";
import { analysisStoreContract } from "./store-contract.js";

analysisStoreContract("memory", createMemoryAnalysisStore);
