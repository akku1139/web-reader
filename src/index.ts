import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"

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
    fetch(url)
    new HTMLRewriter()
  }
)

export default app
