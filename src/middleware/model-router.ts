/**
 * BlackRoad Gateway — Model Router
 * Routes requests to appropriate model based on task type
 */

export interface ModelConfig {
  name: string;
  provider: "ollama" | "openai" | "anthropic" | "huggingface";
  baseUrl: string;
  maxTokens: number;
  costPerToken: number;
  capabilities: string[];
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  "qwen2.5:3b": {
    name: "qwen2.5:3b", provider: "ollama",
    baseUrl: "http://localhost:11434",
    maxTokens: 32768, costPerToken: 0,
    capabilities: ["chat", "code", "reasoning", "world-gen"],
  },
  "qwen2.5:7b": {
    name: "qwen2.5:7b", provider: "ollama",
    baseUrl: "http://localhost:11434",
    maxTokens: 32768, costPerToken: 0,
    capabilities: ["chat", "code", "reasoning", "analysis"],
  },
  "nomic-embed-text": {
    name: "nomic-embed-text", provider: "ollama",
    baseUrl: "http://localhost:11434",
    maxTokens: 8192, costPerToken: 0,
    capabilities: ["embedding", "search"],
  },
  "llama3.2:1b": {
    name: "llama3.2:1b", provider: "ollama",
    baseUrl: "http://localhost:11434",
    maxTokens: 8192, costPerToken: 0,
    capabilities: ["chat", "quick-tasks"],
  },
};

const TASK_MODEL_AFFINITY: Record<string, string> = {
  "code":      "qwen2.5:7b",
  "reasoning": "qwen2.5:7b",
  "chat":      "qwen2.5:3b",
  "embedding": "nomic-embed-text",
  "world-gen": "qwen2.5:3b",
  "quick":     "llama3.2:1b",
};

export function routeModel(requestedModel: string | undefined, taskHint?: string): ModelConfig {
  // Use requested model if valid
  if (requestedModel && MODEL_REGISTRY[requestedModel]) {
    return MODEL_REGISTRY[requestedModel];
  }
  
  // Route by task type
  if (taskHint && TASK_MODEL_AFFINITY[taskHint]) {
    const modelName = TASK_MODEL_AFFINITY[taskHint];
    return MODEL_REGISTRY[modelName];
  }
  
  // Default
  return MODEL_REGISTRY["qwen2.5:3b"];
}

export function getAvailableModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY);
}
