import { GoogleGenAI } from "@google/genai";

/**
 * Returns an initialized instance of the GoogleGenAI client.
 * Throws an explicit configuration error if the API key is missing.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Configuration Error: GEMINI_API_KEY is not defined in the environment.");
  }
  return new GoogleGenAI({ apiKey });
}
