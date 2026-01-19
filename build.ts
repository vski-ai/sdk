const result = await Deno.bundle({
  entrypoints: ["./exports.ts"],
  outputDir: "dist",
  platform: "browser",
  minify: true,
  sourcemap: "linked",
  write: true,
});

console.log(result);

console.log("Generating types...");
const dtsCommand = new Deno.Command("deno", {
  args: [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "npm:dts-bundle-generator@9.5.1",
    "--no-check",
    "-o",
    "dist/exports.d.ts",
    "exports.ts",
  ],
});

const { code, stdout, stderr } = await dtsCommand.output();

if (code === 0) {
  console.log("Types generated successfully at dist/exports.d.ts");
} else {
  console.error("Failed to generate types:");
  console.error(new TextDecoder().decode(stdout));
  console.error(new TextDecoder().decode(stderr));
  Deno.exit(code);
}
