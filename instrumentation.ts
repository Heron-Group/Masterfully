/**
 * Runs once when the server starts: prepares the content repository (cloning
 * it from GitHub if the folder is empty) so the first request doesn't pay for
 * it. Each user's workspace index is built on their first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getRepo } = await import("./lib/content");
  try {
    const repo = await getRepo();
    console.log(`[content] ready at ${repo.dir}`);
  } catch (err) {
    // Don't stop the server: pages will show the error and retry on next use.
    console.error("[content] failed to initialise:", err);
  }
}
