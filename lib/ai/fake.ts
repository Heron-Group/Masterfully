import "server-only";

/**
 * Scripted stand-in for the Claude API (AI_FAKE=1, development only).
 * Include "[refuse]" in a title to simulate a refusal, "[fail]" to simulate
 * an API error.
 */
export async function* fakeStream(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  if (prompt.includes("[fail]")) throw new Error("Simulated API failure (AI_FAKE)");
  const title = prompt.match(/Title: (.*)/)?.[1] ?? prompt.match(/<group title="([^"]*)"/)?.[1] ?? "this material";
  const text = prompt.includes("### What it explores")
    ? `### Abstract\n\n*No abstract in the source; written for this summary.*\n\nA simulated summary of **${title}**, produced without calling the API (AI_FAKE=1).\n\n### What it explores\n\n- **First theme:** a simulated point.\n- **Second theme:** another simulated point.\n\n### Key findings and citable claims\n\n- A simulated finding (p. 3).\n\n### In brief\n\nA simulated overview of ${title}: what it is about, in a few lines, for the reading group page.`
    : `### Main points\n\nA simulated summary of **${title}**, produced without calling the API.\n\n- First point\n- Second point\n\nGenerated in development with AI_FAKE=1.`;
  for (const word of text.split(/(?<= )/)) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 4));
    yield word;
  }
}

export function fakeRefuses(prompt: string): boolean {
  return prompt.includes("[refuse]");
}
