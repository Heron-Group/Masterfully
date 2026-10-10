import "server-only";
import path from "node:path";

/** Server configuration from environment variables. See .env.example. */
export function serverConfig() {
  const env = process.env;
  const production = env.NODE_ENV === "production";
  const contentDir = env.CONTENT_DIR?.trim() || (production ? "" : ".dev-content");
  if (!contentDir) throw new Error("CONTENT_DIR must be set in production");
  // The standalone server changes into its own folder, so relative paths
  // would point inside the build output.
  if (production && !path.isAbsolute(contentDir)) {
    throw new Error(`CONTENT_DIR must be an absolute path in production (got "${contentDir}")`);
  }

  return {
    production,
    // turbopackIgnore: runtime paths, not files to bundle into the build output.
    contentDir: path.resolve(/*turbopackIgnore: true*/ contentDir),
    git: {
      remote: env.CONTENT_GIT_REMOTE?.trim() || undefined,
      branch: env.CONTENT_GIT_BRANCH?.trim() || "main",
      sshKeyPath: env.GIT_SSH_KEY_PATH?.trim() || undefined,
      pushDelayMs: Math.max(1, Number(env.GIT_PUSH_DELAY_SECONDS) || 60) * 1000,
      authorName: env.GIT_AUTHOR_NAME?.trim() || "Research Portal",
      authorEmail: env.GIT_AUTHOR_EMAIL?.trim() || "research-portal@localhost",
    },
    cacheDir: path.resolve(/*turbopackIgnore: true*/ env.CACHE_DIR?.trim() || ".cache"),
    /** Encrypted per-user secrets (AI API keys). Outside the content repo. */
    secretsDir: path.resolve(/*turbopackIgnore: true*/ env.SECRETS_DIR?.trim() || ".secrets"),
    /** Your account: gets the pre-multi-user content on first sign-in. */
    ownerEmail: env.OWNER_EMAIL?.trim() || undefined,
    /** Public address of the app, for sign-in redirects (e.g. https://research.example.com). */
    appUrl: env.APP_URL?.trim().replace(/\/+$/, "") || undefined,
  };
}
