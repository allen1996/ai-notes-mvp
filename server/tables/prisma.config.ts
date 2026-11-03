import { defineConfig } from "prisma/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export default defineConfig({
  schema: "./schema.prisma",
  datasource: {
    url: pathToFileURL(resolve(process.env.DATA_DIR ?? ".data", "meet.sqlite"))
      .href,
  },
});
