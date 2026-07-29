import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = fs.readFileSync(path.join(packageRoot, "skills", "using-subagents", "SKILL.md"), "utf8");

const requiredContract = [
  "Apply this section when the controlling task has selected a review depth.",
  "In Default mode, delegate at most one matching specialist review",
  "Reviewer availability is not a trigger.",
  "Choose model and thinking level only after that delegation is justified.",
  "Parallel delegation is appropriate for independent implementation slices",
  "Parallel review requires distinct named concerns and either explicit Thorough mode or a user checkpoint",
  "Do not ask a reviewer to broadly review those fixes or discover a new issue set.",
  "run focused regression checks in the root session.",
];

for (const requirement of requiredContract) {
  assert(skill.includes(requirement), `Expected using-subagents guidance to include: ${requirement}`);
}

assert(!/`\/(?:plan|work|review)`|packaged workflow|workflow intent/.test(skill), "Delegation skill must not couple itself to packaged prompt activation policy.");

console.log("pi-subagents bounded delegation skill contract tests passed");
