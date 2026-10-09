/**
 * Runs once when the server starts: prepares the content repository (cloning
 * it from GitHub if the folder is empty) and builds the in-memory index, so
 * the first request doesn't pay for it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getContentStore } = await import("./lib/content");
  try {
    const store = await getContentStore();
    console.log(`[content] ready at ${store.dir}`);
  } catch (err) {
    // Don't stop the server: pages will show the error and retry on next use.
    console.error("[content] failed to initialise:", err);
  }
}
