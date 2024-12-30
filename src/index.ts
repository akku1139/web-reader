import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"
//import * as htmlparser2 from "htmlparser2"
import * as htmlparser from "node-html-parser"

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
    return {
      url
    }
  }),
  async c => {
    const { url } = c.req.valid("query")
    const rawDoc = await (await fetch(url)).text()
    // const document = htmlparser2.parseDocument(rawDoc)
    const document = htmlparser.parse(rawDoc)
    const article = new Readability({
      documentElement: document,
      ...document,
    }).parse()!

    return c.html(article.content)
  }
)
.onError((e, c) => {
  console.error(e)
  return c.text(`name: ${e.name}, msg: ${e.message}`)
})

export default app
