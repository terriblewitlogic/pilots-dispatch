import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../" + specifier.slice(2), import.meta.url).href;
    if (
      (specifier.startsWith(".") || specifier.startsWith("file:")) &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url) + ".ts")) specifier = url.href + ".ts";
    }
    return next(specifier, context);
  },
});
