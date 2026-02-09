type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let pdfNodePolyfillPromise: Promise<void> | null = null;

async function ensurePdfJsNodePolyfills() {
  if (typeof window !== "undefined") {
    return;
  }

  const globalWithPolyfills = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
    navigator?: Navigator;
  };

  if (
    globalWithPolyfills.DOMMatrix &&
    globalWithPolyfills.ImageData &&
    globalWithPolyfills.Path2D
  ) {
    return;
  }

  if (!pdfNodePolyfillPromise) {
    pdfNodePolyfillPromise = import("@napi-rs/canvas")
      .then((canvas) => {
        if (!globalWithPolyfills.DOMMatrix) {
          globalWithPolyfills.DOMMatrix = canvas.DOMMatrix as unknown as typeof DOMMatrix;
        }
        if (!globalWithPolyfills.ImageData) {
          globalWithPolyfills.ImageData = canvas.ImageData as unknown as typeof ImageData;
        }
        if (!globalWithPolyfills.Path2D) {
          globalWithPolyfills.Path2D = canvas.Path2D as unknown as typeof Path2D;
        }
      })
      .catch((error) => {
        throw new Error(
          `Failed to initialize PDF polyfills from @napi-rs/canvas: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  await pdfNodePolyfillPromise;

  if (
    !globalWithPolyfills.DOMMatrix ||
    !globalWithPolyfills.ImageData ||
    !globalWithPolyfills.Path2D
  ) {
    throw new Error("PDF runtime polyfills are unavailable in the current environment.");
  }

  if (!globalWithPolyfills.navigator?.language) {
    try {
      Object.defineProperty(globalWithPolyfills, "navigator", {
        value: {
          language: "en-US",
          platform: "",
          userAgent: "",
        } as Navigator,
        configurable: true,
      });
    } catch {}
  }
}

async function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = ensurePdfJsNodePolyfills().then(() =>
      import("pdfjs-dist/legacy/build/pdf.mjs"),
    );
  }
  return pdfJsModulePromise;
}

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const { getDocument } = await getPdfJsModule();
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableAutoFetch: true,
    worker: null as never,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => "str" in item)
      .map((item) => (item as { str: string }).str)
      .join(" ");
    pages.push(text);
  }

  doc.destroy();
  return pages.join(" ").replace(/\s+/g, " ").trim();
}
