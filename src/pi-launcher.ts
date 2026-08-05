import * as fs from "node:fs";
import * as path from "node:path";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export interface PiLauncher {
	readonly command: string;
	readonly argsPrefix: readonly string[];
	readonly source: "injected" | "verified-pi-cli";
}

/**
 * Resolve only the script actually hosting this process. Arbitrary Node test
 * files and an unverified `pi` found on PATH are intentionally rejected.
 */
export function findVerifiedPiCliLauncher(argv: readonly string[] = process.argv, execPath = process.execPath): PiLauncher | undefined {
	const script = argv[1];
	if (!script || !isFile(script)) return undefined;
	const scriptPath = canonical(script);
	let directory = path.dirname(scriptPath);
	while (true) {
		const manifestPath = path.join(directory, "package.json");
		if (isFile(manifestPath)) {
			try {
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { name?: unknown; bin?: unknown };
				if (manifest.name !== PI_PACKAGE_NAME) return undefined;
				const bins = typeof manifest.bin === "string"
					? [manifest.bin]
					: manifest.bin && typeof manifest.bin === "object"
						? Object.values(manifest.bin as Record<string, unknown>).filter((value): value is string => typeof value === "string")
						: [];
				if (!bins.some((entry) => canonical(path.resolve(directory, entry)) === scriptPath)) return undefined;
				return Object.freeze({ command: execPath, argsPrefix: Object.freeze([scriptPath]), source: "verified-pi-cli" as const });
			} catch {
				return undefined;
			}
		}
		const parent = path.dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

export function normalizeInjectedPiLauncher(launcher: Omit<PiLauncher, "source"> & { readonly source?: "injected" }): PiLauncher {
	if (typeof launcher.command !== "string" || launcher.command.trim() === "" || !Array.isArray(launcher.argsPrefix) || launcher.argsPrefix.some((value) => typeof value !== "string")) {
		throw new TypeError("Injected Pi launcher requires a command and string argsPrefix.");
	}
	return Object.freeze({ command: launcher.command, argsPrefix: Object.freeze([...launcher.argsPrefix]), source: "injected" });
}

export function piInvocation(launcher: PiLauncher, args: readonly string[]): { command: string; args: string[] } {
	return { command: launcher.command, args: [...launcher.argsPrefix, ...args] };
}

function isFile(value: string): boolean {
	try { return fs.statSync(value).isFile(); }
	catch { return false; }
}

function canonical(value: string): string {
	let result: string;
	try { result = fs.realpathSync.native(value); }
	catch { result = path.resolve(value); }
	result = path.normalize(result);
	return process.platform === "win32" ? result.toLowerCase() : result;
}
