import { Hono } from "hono"
import { validator } from "hono/validator"
import { Readability } from "@mozilla/readability"

const app = new Hono()
.get("/read",
  validator("query", (v, c) => {
    const url = v["url"]
    if (!url) {
      return // error
    }
    if (Array.isArray(url)) {
      return
    }
    if (!URL.canParse(url)) {
      return {
        url
      }
    }
  }),
  async c => {
    const { url } = c.req.valid("query")
  }
)

export default app
