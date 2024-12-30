//@ts-check
import esbuild from "esbuild"

await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  // minify: true,
  format: "esm",
  outfile: "./public/_worker.js"
})
