import "server-only";

/**
 * Scripted stand-in for the Claude API (AI_FAKE=1, development only).
 * Include "[refuse]" in a title to simulate a refusal, "[fail]" to simulate
 * an API error.
 */
export async function* fakeStream(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  if (prompt.includes("[fail]")) throw new Error("Simulated API failure (AI_FAKE)");
  const title = prompt.match(/Title: (.*)/)?.[1] ?? prompt.match(/<group title="([^"]*)"/)?.[1] ?? "this material";
  const text = `### Argument\n\nA simulated summary of **${title}**, produced without calling the API.\n\n### Key concepts and methods\n\n- First concept\n- Second concept\n\n### Relevance to my research\n\nGenerated in development with AI_FAKE=1.`;
  for (const word of text.split(/(?<= )/)) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 4));
    yield word;
  }
}

export function fakeRefuses(prompt: string): boolean {
  return prompt.includes("[refuse]");
}
