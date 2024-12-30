//@ts-check
import esbuild from "esbuild"
import fs from "node:fs"

await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  // minify: true,
  format: "esm",
  outfile: "./public/_worker.js"
})

fs.copyFileSync("./public/_worker.js","./public/static/raw.js")
