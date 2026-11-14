import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureRoot, languageFixtures, supportedGrammars } from "./language-fixtures.ts";

test("covers every grammar in the pinned backend with a nonempty source fixture", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const backend = await Bun.file(new URL("../node_modules/codebase-memory-mcp/package.json", import.meta.url)).json();
  expect(pkg.dependencies["codebase-memory-mcp"]).toBe("0.12.1");
  expect(backend.version).toBe("0.12.1");
  expect(supportedGrammars).toHaveLength(162);
  expect(languageFixtures.map((fixture) => fixture.language).sort()).toEqual(supportedGrammars);
  expect(new Set(languageFixtures.map((fixture) => fixture.file)).size).toBe(162);
  for (const fixture of languageFixtures) {
    expect(fixture.file.startsWith(`${fixture.language}/`)).toBe(true);
    expect((await readFile(join(fixtureRoot, fixture.file), "utf8")).trim().length).toBeGreaterThan(0);
    expect(fixture.minDefinitions).toBeGreaterThanOrEqual(0);
    if (fixture.call) {
      expect((await readFile(join(fixtureRoot, fixture.call.file), "utf8")).trim().length).toBeGreaterThan(0);
      expect(fixture.call.caller.length).toBeGreaterThan(0);
      expect(fixture.call.callee.length).toBeGreaterThan(0);
    }
  }
  const directories = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  expect(directories).toEqual(supportedGrammars);
});
