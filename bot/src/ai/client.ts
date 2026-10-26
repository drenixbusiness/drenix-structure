import OpenAI from "openai";
import { config } from "../config.js";

export const openai = new OpenAI({ apiKey: config.openaiKey, maxRetries: 2, timeout: 90_000 });

/** gpt-5.x / o-series are reasoning models: no temperature, a reasoning effort instead. */
const reasoning = /^(gpt-5|o\d)/.test(config.openaiModel);

/** Sampling options that fit the configured model. */
export function modelOpts(temperature: number): { temperature?: number; reasoning_effort?: OpenAI.ReasoningEffort } {
  return reasoning ? { reasoning_effort: config.openaiReasoning as OpenAI.ReasoningEffort } : { temperature };
}
