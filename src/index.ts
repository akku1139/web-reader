import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"
import * as htmlparser2 from "htmlparser2"

const app = new Hono()
.get("/read",
  validator("query", (v, c) => {
    const url = v["url"]
    if (!url) {
      return c.text("error", 400)
    }
    if (Array.isArray(url)) {
      return c.text("error", 400)
    }
    if (!URL.canParse(url)) {
      return {
        url
      }
    }
    return c.text("error", 400)
  }),
  async c => {
    const { url } = c.req.valid("query")
    const rawDoc = await (await fetch(url)).text()
    const document = htmlparser2.parseDocument(rawDoc)
    const article = new Readability(document).parse()!

    return c.html(article.content)
  }
)

export default app
