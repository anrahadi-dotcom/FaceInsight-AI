// Catch redeclared top-level identifiers across the engine modules.
//
// WHY THIS IS NEEDED: `node --check` reports OK for a file that declares the same
// top-level function twice. A redeclaration is a runtime SyntaxError that kills
// the ENTIRE module -- so every feature it powers silently stops working while
// the syntax checker says the file is fine. That is exactly how a duplicate
// clamp01 shipped and took the whole page down.
//
// This parses each module and looks for two declarations of the same name in the
// same file scope.
const fs = require("fs");

const files = [
  "js/faceEngine.js",
  "js/main.js",
  "js/hairstyle.js",
  "js/hairstyle-ui.js",
  "js/report-export.js",
  "js/connectivity.js",
  "js/boot-guard.js",
  "js/scale.js",
  "js/tips.js",
];

// HOW THIS AVOIDS FALSE POSITIVES: the first version used INDENTATION as a proxy
// for nesting and reported 243 bogus duplicates, because a `const` inside a
// function is indented too. This version counts brace depth, so `const px` in one
// function and `const px` in another are correctly treated as separate scopes.
function topLevelDeclarations(src) {
  // Strip comments and string literals first, so braces inside them cannot skew
  // the depth count. Crude, but it errs toward removing text rather than
  // inventing structure.
  const SPACE = String.fromCharCode(32);
  const clean = src
    .replace(/\/\*[\s\S]*?\*\//g, SPACE)
    .replace(/\/[^\n]*/g, SPACE)
    .replace(/`(?:\\.|[^`\\])*`/g, "STR")
    .replace(/'(?:\\.|[^'\\])*'/g, "STR")
    .replace(/"(?:\\.|[^"\\])*"/g, "STR");

  const re =
    /(?:function\s+([A-Za-z_$][\w$]*))|(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)|(?:class\s+([A-Za-z_$][\w$]*))/g;

  const decls = [];
  let depth = 0;
  let last = 0;
  let m;

  while ((m = re.exec(clean))) {
    // Advance the brace depth from the previous match up to this one.
    for (let i = last; i < m.index; i++) {
      const ch = clean[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    last = m.index;

    // Only depth 0 counts as top level. A declaration nested inside a function is
    // legal even when its name matches one somewhere else in the file.
    if (depth === 0) {
      const name = m[1] || m[2] || m[3];
      if (name) decls.push({ name, line: clean.slice(0, m.index).split("\n").length });
    }
  }
  return decls;
}

let problems = 0;

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const decls = topLevelDeclarations(fs.readFileSync(file, "utf8"));
  const seen = new Map();
  const dupes = [];

  for (const d of decls) {
    if (seen.has(d.name)) dupes.push({ name: d.name, first: seen.get(d.name), again: d.line });
    else seen.set(d.name, d.line);
  }

  if (dupes.length) {
    problems += dupes.length;
    console.log("\n" + file);
    dupes.forEach((d) =>
      console.log("  DUPLICATE top-level '" + d.name + "': line " + d.first + " and line " + d.again),
    );
  } else {
    console.log(file + ": " + decls.length + " top-level declarations, no duplicates");
  }
}

console.log(
  "\n" + (problems === 0 ? "OK -- no duplicate top-level declarations." : problems + " problem(s)."),
);
process.exit(problems === 0 ? 0 : 1);
