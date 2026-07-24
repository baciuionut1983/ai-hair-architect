/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadEnvCoreGate() {
  const sourcePath = path.join(__dirname, "..", "src", "lib", "env-core-gate.ts");
  const sourceCode = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: sourcePath
  });

  const moduleRef = { exports: {} };
  const compiledFactory = new Function(
    "module",
    "exports",
    "require",
    "__dirname",
    "__filename",
    transpiled.outputText
  );

  compiledFactory(moduleRef, moduleRef.exports, require, path.dirname(sourcePath), sourcePath);
  return moduleRef.exports;
}

function run() {
  const envGate = loadEnvCoreGate();
  const result = envGate.validateBuildTimeEnvironment(process.env);

  if (!result.ok) {
    const formatted = envGate.formatValidationIssues(result.issues);
    console.error("[CORE_GATE][BUILD_ENV] Validation failed.");
    if (formatted) {
      console.error(formatted);
    }
    process.exit(1);
  }

  console.log("[CORE_GATE][BUILD_ENV] Validation passed.");
}

run();
