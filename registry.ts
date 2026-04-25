/**
 * Shared package-agent registry for subagent-tools.
 *
 * Other Pi packages can register their package-owned `agents/` directory by
 * appending an entry to the global registry keyed by this symbol. We use
 * `globalThis` so independently loaded package copies can still coordinate.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const PACKAGE_AGENT_REGISTRY_SYMBOL = Symbol.for("pi.subagent-tools.agent-dir-registry");

export interface RegisteredPackageAgentDir {
	agentDir: string;
	packageRoot: string;
	packageName?: string;
	registeredBy?: string;
}

interface PackageAgentRegistry {
	packageAgentDirs: RegisteredPackageAgentDir[];
}

function getRegistry(): PackageAgentRegistry {
	const globalState = globalThis as Record<PropertyKey, unknown>;
	const existing = globalState[PACKAGE_AGENT_REGISTRY_SYMBOL];
	if (existing && typeof existing === "object") {
		return existing as PackageAgentRegistry;
	}
	const created: PackageAgentRegistry = { packageAgentDirs: [] };
	globalState[PACKAGE_AGENT_REGISTRY_SYMBOL] = created;
	return created;
}

function normalizeExistingPath(targetPath: string): string {
	const resolved = (() => {
		try {
			return fs.realpathSync.native(targetPath);
		} catch {
			return path.resolve(targetPath);
		}
	})();
	return resolved.replace(/\\/g, "/");
}

function samePath(a: string, b: string): boolean {
	const normalizeForCompare = (value: string) => {
		const normalized = path.normalize(value);
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	};
	return normalizeForCompare(a) === normalizeForCompare(b);
}

export function registerPackageAgentDir(entry: RegisteredPackageAgentDir): void {
	if (!entry.agentDir || !entry.packageRoot) return;

	const agentDir = normalizeExistingPath(entry.agentDir);
	const packageRoot = normalizeExistingPath(entry.packageRoot);

	try {
		if (!fs.statSync(agentDir).isDirectory()) return;
	} catch {
		return;
	}

	const registry = getRegistry();
	const existing = registry.packageAgentDirs.find(
		(candidate) => samePath(candidate.agentDir, agentDir) && samePath(candidate.packageRoot, packageRoot),
	);

	if (existing) {
		existing.packageName = entry.packageName?.trim() || existing.packageName;
		existing.registeredBy = entry.registeredBy?.trim() || existing.registeredBy;
		return;
	}

	registry.packageAgentDirs.push({
		agentDir,
		packageRoot,
		packageName: entry.packageName?.trim() || undefined,
		registeredBy: entry.registeredBy?.trim() || undefined,
	});
}

export function getRegisteredPackageAgentDirs(): RegisteredPackageAgentDir[] {
	return [...getRegistry().packageAgentDirs];
}

export function clearRegisteredPackageAgentDirsForTests(): void {
	getRegistry().packageAgentDirs = [];
}
