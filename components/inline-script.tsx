/**
 * A script that runs during HTML parsing on full page loads. On the client
 * it renders as inert text/plain, avoiding React's warning about rendering
 * <script> tags (see Next.js "Preventing flash before hydration").
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
