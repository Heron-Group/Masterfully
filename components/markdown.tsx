import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children, ...props }) => {
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
 * Renders Markdown (with GitHub tables, task lists, strikethrough). Raw HTML
 * in the source is not rendered.
 */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-rp ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
