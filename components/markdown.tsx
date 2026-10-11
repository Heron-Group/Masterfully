import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children, ...props }) => {
    // Links to a source in the library ([text](/library/<id>)), shown as a mention.
    if (href?.startsWith("/library/")) {
      return (
        <a href={href} target="_blank" rel="noopener" className="source-link" title="Open source in a new tab">
          {children}
        </a>
      );
    }
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
};

/**
 * Renders Markdown (with GitHub tables, task lists, strikethrough). Single
 * line breaks are kept, as in the editor and in Obsidian. Raw HTML in the
 * source is not rendered.
 */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-rp ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
