import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface LanguageFixture {
  language: string;
  file: string;
  minDefinitions: number;
  definitions: string[];
  excluded?: string;
  limitation?: string;
  call?: {
    file: string;
    caller: string;
    callee: string;
  };
}

export const fixtureRoot = fileURLToPath(new URL("./fixtures/languages/", import.meta.url));
export const languageFixtures: LanguageFixture[] = JSON.parse(
  await readFile(new URL("./fixtures/languages/manifest.json", import.meta.url), "utf8"),
);

// Independent inventory of vendored grammar directories at upstream v0.12.1.
// Keep this separate from the cases so deleting a case cannot reduce coverage silently.
export const supportedGrammars = `
ada agda apex arkts assembly astro awk bash beancount bibtex bicep bitbake blade
c c_sharp cairo capnp cfml cfscript chialisp clojure cmake cobol commonlisp cpp
crystal css csv cuda d dart devicetree diff dockerfile dotenv elisp elixir elm
erlang fennel fish form fortran fsharp func gdscript gitattributes gitignore gleam
glsl gn go gomod gotemplate graphql groovy hare haskell hcl hlsl html hyprlang ini
ispc janet java javascript jinja2 jsdoc json json5 jsonnet julia just kconfig kdl
kotlin lean linkerscript liquid llvm lua luau magma make markdown matlab mermaid
meson mojo move nasm nickel nix objc objectscript_routine objectscript_udl ocaml
odin pascal perl php pine pkl plsql po pony powershell prisma properties protobuf
puppet purescript python qml r racket regex requirements rescript ron rst ruby
rust scala scheme scss slang smali smithy solidity soql sosl sql squirrel
sshconfig starlark svelte sway swift systemverilog tablegen tcl teal templ thrift
tlaplus toml tsx typescript typst verilog vhdl vim vue wgsl wit wolfram xml yaml zig zsh
`.trim().split(/\s+/).sort();
