"use client";

import { Minus, MoveHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "pdfjs-dist/web/pdf_viewer.css";

/** What the reading panel's read-aloud needs from the viewer. */
export type PdfApi = {
  pageCount(): number;
  currentPage(): number;
  goToPage(page: number): void;
  /** Each page's text, as pdf.js lays it out (line ends as newlines). */
  pageTexts(): Promise<string[]>;
  /** The rendered, selectable text of a page (only pages near the view are rendered). */
  textLayer(page: number): HTMLElement | null;
  /** The scrolling element. */
  scroller(): HTMLElement | null;
};

type TextItem = { str?: string; hasEOL?: boolean };
type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }> };

type Viewer = {
  currentScaleValue: string;
  currentScale: number;
  currentPageNumber: number;
  pagesCount: number;
  setDocument(doc: unknown): void;
  cleanup?: () => void;
};

/**
 * PDF viewer built on pdf.js, so it behaves the same in every browser
 * (including iPhone Safari, which only shows the first page of an embedded
 * PDF): continuous pages, selectable text for copying quotes, links, zoom.
 */
export function PdfViewer({ url, title, onReady }: { url: string; title: string; onReady?: (api: PdfApi | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        // The viewer component reads the library from this global.
        (globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;
        const { EventBus, PDFLinkService, PDFViewer } = await import("pdfjs-dist/web/pdf_viewer.mjs");
        if (cancelled || !container.current) return;

        const eventBus = new EventBus();
        const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2 /* new tab */ });
        const viewer = new PDFViewer({
          container: container.current,
          eventBus,
          linkService,
          removePageBorders: false,
        }) as unknown as Viewer;
        linkService.setViewer(viewer as never);
        viewerRef.current = viewer;

        eventBus.on("pagesinit", () => {
          viewer.currentScaleValue = "page-width";
          setPages(viewer.pagesCount);
        });
        eventBus.on("pagechanging", (e: { pageNumber: number }) => setPage(e.pageNumber));

        const task = pdfjs.getDocument({ url, withCredentials: true });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        if (cancelled) return;
        viewer.setDocument(doc);
        linkService.setDocument(doc, null);

        let texts: Promise<string[]> | null = null;
        const pdf = doc as unknown as PdfDoc;
        onReady?.({
          pageCount: () => pdf.numPages,
          currentPage: () => viewer.currentPageNumber,
          goToPage: (n) => {
            viewer.currentPageNumber = n;
          },
          pageTexts: () =>
            (texts ??= (async () => {
              const out: string[] = [];
              for (let n = 1; n <= pdf.numPages; n++) {
                const content = await (await pdf.getPage(n)).getTextContent();
                out.push(content.items.map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : "")).join(""));
              }
              return out;
            })()),
          textLayer: (n) => container.current?.querySelector<HTMLElement>(`.page[data-page-number="${n}"] .textLayer`) ?? null,
          scroller: () => container.current,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't open the PDF.");
      }
    })();

    // Keep "fit width" when the panel is resized.
    const resize = new ResizeObserver(() => {
      const v = viewerRef.current;
      if (v && v.currentScaleValue === "page-width") v.currentScaleValue = "page-width";
    });
    if (container.current) resize.observe(container.current);

    return () => {
      cancelled = true;
      onReady?.(null);
      resize.disconnect();
      destroy?.();
      viewerRef.current = null;
    };
    // onReady is only read when the document opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const zoom = (factor: number) => {
    const v = viewerRef.current;
    if (v) v.currentScaleValue = String(Math.min(4, Math.max(0.4, v.currentScale * factor)));
  };
  const fitWidth = () => {
    const v = viewerRef.current;
    if (v) v.currentScaleValue = "page-width";
  };

  const tool = "rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-rule px-3 text-xs text-muted">
        <span className="mr-auto tabular-nums" aria-live="polite">
          {pages ? `Page ${page} of ${pages}` : error ? "" : "Opening…"}
        </span>
        <button type="button" onClick={() => zoom(1 / 1.15)} className={tool} title="Zoom out" aria-label="Zoom out">
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => zoom(1.15)} className={tool} title="Zoom in" aria-label="Zoom in">
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={fitWidth} className={tool} title="Fit width" aria-label="Fit width">
          <MoveHorizontal size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-accent-soft/50">
        {error ? (
          <p role="alert" className="p-6 text-sm text-danger">
            Couldn&apos;t open this PDF ({error}). Try opening it in a new tab.
          </p>
        ) : (
          <div ref={container} className="pdf-container absolute inset-0 overflow-auto" aria-label={`PDF: ${title}`}>
            <div className="pdfViewer" />
          </div>
        )}
      </div>
    </div>
  );
}
