import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"

type ReaderOptions = {
  url: string
  /** "html": rendered article (default), "text": stripped plain text */
  mode: "html" | "text"
  /** "on": rewrite links to stay in the reader (default), "off": keep original hrefs */
  links: "on" | "off"
}

/**
 * Rewrite links inside the extracted article so that clicking a link keeps
 * reading within web-reader (/read?url=...).
 * - Fragment-only links (#foo) are kept as-is.
 * - mailto:/tel:/javascript: etc. are neutralized to plain text.
 * - Each rewritten link gets a small superscript "⧉" linking directly to the
 *   original URL.
 */
function rewriteLinks(content: string, baseUrl: string): string {
  const { document } = parseHTML(`<div id="__web-reader-wrap">${content}</div>`)
  const wrap = document.querySelector("#__web-reader-wrap")!
  for (const a of wrap.querySelectorAll("a[href]")) {
    const raw = a.getAttribute("href") ?? ""
    if (raw.startsWith("#")) continue

    let abs: URL
    try {
      abs = new URL(raw, baseUrl)
    } catch {
      a.replaceWith(...a.childNodes)
      continue
    }

    if (!/^https?:/.test(abs.href)) {
      // mailto:, tel:, etc. -> keep the text but drop the link
      a.replaceWith(...a.childNodes)
      continue
    }

    const direct = document.createElement("a")
    direct.href = abs.href
    direct.className = "direct-link"
    direct.setAttribute("rel", "noopener noreferrer")
    direct.textContent = "⧉"

    a.setAttribute("href", `/read?url=${encodeURIComponent(abs.href)}`)
    a.setAttribute("title", abs.href)
    a.after(direct)
  }
  return wrap.innerHTML
}

/**
 * Strip the extracted article down to plain text, keeping paragraph breaks
 * and list structure readable.
 */
function toPlainText(content: string): string {
  return content
    // drop elements that carry no reading content
    .replaceAll(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // newline after block-level boundaries
    .replaceAll(/<\/(p|h[1-6]|li|blockquote|pre|tr|div|section|article|figcaption|dt|dd)>/gi, "\n")
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<li\b[^>]*>/gi, "• ")
    // strip remaining tags
    .replaceAll(/<[^>]+>/g, "")
    // decode entities
    .replaceAll(/&nbsp;/g, " ")
    .replaceAll(/&amp;/g, "&")
    .replaceAll(/&lt;/g, "<")
    .replaceAll(/&gt;/g, ">")
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&#0?39;/g, "'")
    .replaceAll(/&#x27;/gi, "'")
    // normalize whitespace (keep intentional newlines)
    .split("\n")
    .map(line => line.replaceAll(/\s+/g, " ").trim())
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim()
}

const app = new Hono()
.get("/read",
  validator("query", (v, c) => {
    const url = v["url"]
    // no URL given: show the form page instead of an error
    if (!url) {
      return { url: "", mode: "html" as const, links: "on" as const }
    }
    if (Array.isArray(url)) {
      return c.text("error (Multiple URLs are not allowed)", 400)
    }
    if (!URL.canParse(url)) {
      return c.text("error (Cannot parse URL)", 400)
    }
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.text("error (Only http/https are allowed)", 400)
    }
    const mode = v["mode"] === "text" ? "text" as const : "html" as const
    const links = v["links"] === "off" ? "off" as const : "on" as const
    return {
      url,
      mode,
      links,
    } satisfies ReaderOptions
  }),
  async c => {
    const opts = c.req.valid("query")
    if (!opts.url) {
      return renderFormPage()
    }
    const { url, mode, links } = opts

    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // some sites reject requests without a browser-ish UA
        "User-Agent":
          "Mozilla/5.0 (compatible; web-reader; +https://github.com/akku1139/web-reader)",
        "Accept": "text/html,application/xhtml+xml",
      },
    })
    if (!res.ok) {
      return c.text(`error (Upstream returned ${res.status} ${res.statusText})`, 502)
    }

    const rawDoc = await res.text()

    // linkedom provides a real DOM Document that Readability requires
    const { document } = parseHTML(rawDoc)

    // let Readability resolve relative URLs against the fetched URL
    try {
      Object.defineProperty(document, "baseURI", { value: url })
    } catch { /* best effort */ }

    const reader = new Readability(document, { keepClasses: false })
    const article = reader.parse()
    if (!article?.content) {
      return c.text("error (Failed to extract article content)", 422)
    }

    const title = article.title ?? url
    const byline = article.byline
    const siteName = article.siteName

    const escapedTitle = escapeHtml(title)
    const escapedUrl = escapeHtml(url)
    const meta = [
      siteName ? `<p class="meta">${escapeHtml(siteName)}</p>` : "",
      byline ? `<p class="meta">${escapeHtml(byline)}</p>` : "",
    ].join("\n")

    const body = mode === "text"
      ? `<article class="reader-text">${escapeHtml(toPlainText(article.content))}</article>`
      : links === "on"
        ? rewriteLinks(article.content, url)
        : article.content

    // toolbar: plain <a> toggles, no JavaScript involved
    const q = (over: Partial<ReaderOptions>) => {
      const o = { url, mode, links, ...over }
      return `/read?url=${encodeURIComponent(o.url)}&mode=${o.mode}&links=${o.links}`
    }
    const toolbar = `<nav class="reader-toolbar">
<a href="${q({ mode: mode === "text" ? "html" : "text" })}" class="${mode === "text" ? "active" : ""}">${mode === "text" ? "記事表示" : "テキスト表示"}</a>
<a href="${q({ links: links === "on" ? "off" : "on" })}" class="${links === "on" ? "active" : ""}">リンク加工: ${links === "on" ? "ON" : "OFF"}</a>
<a href="${escapedUrl}" rel="noopener noreferrer">元ページ⧉</a>
<a href="${q({})}">再読込</a>
</nav>`

    return c.html(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle} - web-reader</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="reader-header">
<p><a href="/">← web-reader</a></p>
<h1><a href="${escapedUrl}" rel="noopener noreferrer">${escapedTitle}</a></h1>
${meta}
${toolbar}
<hr>
</header>
<main class="reader-content">
${body}
</main>
<footer class="reader-footer">
<hr>
<p>Extracted by <a href="https://github.com/akku1139/web-reader">web-reader</a> ·
<a href="${q({})}">reload</a></p>
</footer>
</body>
</html>`)
  }
)
.onError((e, c) => {
  console.error(e)
  return c.text(`name: ${e.name}, msg: ${e.message}\nstack: ${e.stack},`)
})

/** No-JS form page shown when /read is opened without ?url= */
function renderFormPage(): Response {
  return new Response(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>web-reader</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="reader-header">
<p><a href="/">← web-reader</a></p>
<h1>web-reader</h1>
<hr>
</header>
<main class="reader-content">
<form method="get" action="/read">
<input type="url" name="url" placeholder="https://example.com" required style="width:100%;padding:0.5rem;font-size:1rem">
<button type="submit" style="width:100%;padding:0.5rem;font-size:1rem;margin-top:0.5rem">読む</button>
</form>
</main>
</body>
</html>`, { headers: { "content-type": "text/html; charset=UTF-8" } })
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export default app
