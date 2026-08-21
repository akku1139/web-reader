import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"

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

const app = new Hono()
.get("/read",
  validator("query", (v, c) => {
    const url = v["url"]
    if (!url) {
      return c.text("error (URL is not set)", 400)
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
    return {
      url
    }
  }),
  async c => {
    const { url } = c.req.valid("query")

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

    const contentType = res.headers.get("content-type") ?? ""
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
<hr>
</header>
<main class="reader-content">
${rewriteLinks(article.content, url)}
</main>
<footer class="reader-footer">
<hr>
<p>Extracted by <a href="https://github.com/akku1139/web-reader">web-reader</a> ·
<a href="/read?url=${encodeURIComponent(url)}">reload</a></p>
</footer>
</body>
</html>`)
  }
)
.onError((e, c) => {
  console.error(e)
  return c.text(`name: ${e.name}, msg: ${e.message}\nstack: ${e.stack},`)
})

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export default app
