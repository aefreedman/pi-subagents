import * as fs from "node:fs";
import * as path from "node:path";
import {
	createCapabilityRegistry,
	type RegistrationToken,
	type RegistryRecord,
} from "@aefree/pi-capability-registry";

export const PACKAGE_AGENT_DIR_REGISTRY_KEY_V1 = "@aefree/pi-subagents/package-agent-directories/v1";
export const PACKAGE_AGENT_DIR_CONTRACT_VERSION_V1 = 1 as const;

export interface PackageAgentDirectoryOwnerV1 {
	readonly packageName: string;
	readonly packageVersion: string;
	readonly packageRoot: string;
	readonly registeredBy: string;
}

export interface RegisteredPackageAgentDir extends RegistryRecord {
	readonly contractVersion: 1;
	readonly id: string;
	readonly kind: "package-agent-directory";
	readonly owner: PackageAgentDirectoryOwnerV1;
	readonly agentDir: string;
}

export interface PackageAgentDirRegistrationInput {
	readonly agentDir: string;
	readonly packageRoot: string;
	readonly registeredBy: string;
}

export interface PackageAgentDirRegistration {
	readonly record?: RegisteredPackageAgentDir;
	unregister(): boolean;
}

export function createPackageAgentDirRegistryV1() {
	return createCapabilityRegistry<RegisteredPackageAgentDir>({
		registryKey: PACKAGE_AGENT_DIR_REGISTRY_KEY_V1,
		contractVersion: PACKAGE_AGENT_DIR_CONTRACT_VERSION_V1,
		compatibleVersions: [PACKAGE_AGENT_DIR_CONTRACT_VERSION_V1],
		validate: assertPackageAgentDirectoryV1,
	});
}

export function registerPackageAgentDir(scope: object, input: PackageAgentDirRegistrationInput): PackageAgentDirRegistration {
	if (!input.agentDir || !input.packageRoot || !input.registeredBy) return Object.freeze({ unregister: () => false });
	const agentDir = normalizeExistingPath(input.agentDir);
	const packageRoot = normalizeExistingPath(input.packageRoot);
	try {
		if (!fs.statSync(agentDir).isDirectory()) return Object.freeze({ unregister: () => false });
	} catch {
		return Object.freeze({ unregister: () => false });
	}
	const manifest = readOwnerManifest(packageRoot);
	const record: RegisteredPackageAgentDir = Object.freeze({
		contractVersion: 1,
		id: `package-agents:${manifest.packageName}:${packageRoot}`,
		kind: "package-agent-directory",
		owner: Object.freeze({
			packageName: manifest.packageName,
			packageVersion: manifest.packageVersion,
			packageRoot,
			registeredBy: input.registeredBy,
		}),
		agentDir,
	});
	const registry = createPackageAgentDirRegistryV1();
	const token = registry.register(scope, record);
	let active = true;
	return Object.freeze({
		record,
		unregister(): boolean {
			if (!active) return false;
			active = false;
			return registry.unregister(token);
		},
	});
}

export function getRegisteredPackageAgentDirs(scope: object): readonly RegisteredPackageAgentDir[] {
	return createPackageAgentDirRegistryV1().snapshotCompatible(scope);
}

/** Test-only reset. Session state is normally released with its weak scope key. */
export function clearRegisteredPackageAgentDirsForTests(): void {
	delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for(PACKAGE_AGENT_DIR_REGISTRY_KEY_V1)];
}

function readOwnerManifest(packageRoot: string): { packageName: string; packageVersion: string } {
	const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
		name?: unknown;
		version?: unknown;
	};
	if (typeof manifest.name !== "string" || manifest.name.trim() === "") throw new TypeError("Package agent owner name is missing.");
	if (typeof manifest.version !== "string" || manifest.version.trim() === "") throw new TypeError("Package agent owner version is missing.");
	return { packageName: manifest.name.trim(), packageVersion: manifest.version.trim() };
}

function assertPackageAgentDirectoryV1(value: unknown): asserts value is RegisteredPackageAgentDir {
	const record = value as Partial<RegisteredPackageAgentDir>;
	if (record.contractVersion !== 1 || record.kind !== "package-agent-directory" || typeof record.id !== "string" || typeof record.agentDir !== "string") {
		throw new TypeError("Invalid package agent directory registration.");
	}
	const owner = record.owner as Partial<PackageAgentDirectoryOwnerV1> | undefined;
	if (!owner || typeof owner.packageName !== "string" || typeof owner.packageVersion !== "string" || typeof owner.packageRoot !== "string" || typeof owner.registeredBy !== "string") {
		throw new TypeError("Invalid package agent directory owner.");
	}
}

function normalizeExistingPath(targetPath: string): string {
	let resolved: string;
	try { resolved = fs.realpathSync.native(targetPath); }
	catch { resolved = path.resolve(targetPath); }
	return resolved.replace(/\\/g, "/");
}

export type { RegistrationToken };
