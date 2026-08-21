import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"

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
    if (!article) {
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
${article.content}
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
