import { childExtensionCliArgs } from "./child-extensions.js";

/**
 * Build the common child Pi arguments.
 *
 * Skills are intentionally not disabled here: each child uses Pi's normal
 * global, project, package, and settings-based skill discovery for its cwd.
 */
export function buildChildBaseArgs(childExtensions: readonly string[]): string[] {
	return ["--mode", "json", "-p", "--no-session", ...childExtensionCliArgs(childExtensions)];
}
