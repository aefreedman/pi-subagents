import * as fs from "node:fs";
import * as path from "node:path";

const MAX_CHILD_EXTENSIONS = 16;
const EXTENSION_FILE_PATTERN = /\.(?:[cm]?[jt]s)$/i;

export interface ChildExtensionConfig {
	settingsPath: string | null;
	projectRoot: string | null;
	extensions: string[];
}

function canonicalPath(targetPath: string): string {
	try {
		return fs.realpathSync.native(targetPath);
	} catch {
		return path.resolve(targetPath);
	}
}

function comparisonPath(targetPath: string): string {
	const normalized = path.normalize(targetPath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(parentPath: string, childPath: string): boolean {
	const relative = path.relative(comparisonPath(parentPath), comparisonPath(childPath));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function findNearestProjectSettings(cwd: string): string | null {
	let current = path.resolve(cwd);
	while (true) {
		const candidate = path.join(current, ".pi", "settings.json");
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function childExtensionCliArgs(extensions: readonly string[]): string[] {
	return extensions.flatMap((extensionPath) => ["-e", extensionPath]);
}

export function resolveChildExtensions(cwd: string): ChildExtensionConfig {
	const settingsPath = findNearestProjectSettings(cwd);
	if (!settingsPath) return { settingsPath: null, projectRoot: null, extensions: [] };

	const projectRoot = canonicalPath(path.dirname(path.dirname(settingsPath)));
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	} catch (error) {
		throw new Error(`Unable to parse child-extension settings at '${settingsPath}': ${error instanceof Error ? error.message : String(error)}`);
	}

	const piSubagents = parsed && typeof parsed === "object" ? (parsed as { piSubagents?: unknown }).piSubagents : undefined;
	if (piSubagents === undefined) return { settingsPath, projectRoot, extensions: [] };
	if (!piSubagents || typeof piSubagents !== "object" || Array.isArray(piSubagents)) {
		throw new Error(`'piSubagents' in '${settingsPath}' must be an object.`);
	}

	const childExtensions = (piSubagents as { childExtensions?: unknown }).childExtensions;
	if (childExtensions === undefined) return { settingsPath, projectRoot, extensions: [] };
	if (!Array.isArray(childExtensions)) {
		throw new Error(`'piSubagents.childExtensions' in '${settingsPath}' must be an array of project-contained extension file paths.`);
	}
	if (childExtensions.length > MAX_CHILD_EXTENSIONS) {
		throw new Error(`'piSubagents.childExtensions' in '${settingsPath}' exceeds the ${MAX_CHILD_EXTENSIONS}-file limit.`);
	}

	const settingsDir = path.dirname(settingsPath);
	const extensions: string[] = [];
	const seen = new Set<string>();
	for (const entry of childExtensions) {
		if (typeof entry !== "string" || !entry.trim()) {
			throw new Error(`Every 'piSubagents.childExtensions' entry in '${settingsPath}' must be a non-empty path string.`);
		}
		const resolved = canonicalPath(path.resolve(settingsDir, entry.trim()));
		if (!isWithin(projectRoot, resolved)) {
			throw new Error(`Child extension '${entry}' resolves outside the trusted project root '${projectRoot}'.`);
		}
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			throw new Error(`Child extension '${entry}' does not resolve to an existing file.`);
		}
		if (!EXTENSION_FILE_PATTERN.test(resolved)) {
			throw new Error(`Child extension '${entry}' must resolve to a .ts, .js, .mts, .mjs, .cts, or .cjs file.`);
		}
		const key = comparisonPath(resolved);
		if (seen.has(key)) continue;
		seen.add(key);
		extensions.push(resolved);
	}

	return { settingsPath, projectRoot, extensions };
}
