/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getRegisteredPackageAgentDirs, type RegisteredPackageAgentDir } from "./registry.js";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project";
export type AgentSourceDetail =
	| "user-local"
	| "user-package"
	| "project-local"
	| "project-config-path"
	| "project-package";
export type AgentStrictness = "low" | "medium" | "high" | string;
export type AgentOutputFormat = "text" | "markdown_sections" | "json" | string;
export type AgentClass = "research" | "review" | "workflow" | "planning" | "implementation" | string;

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	sourceDetail: AgentSourceDetail;
	filePath: string;
	agentClass?: AgentClass;
	outputFormat?: AgentOutputFormat;
	requiredSections?: string[];
	strictness?: AgentStrictness;
	packageName?: string;
	packageRoot?: string;
	discoveredFrom?: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	projectConfigAgentDirs: string[];
	registeredPackageAgentDirs: RegisteredPackageAgentDir[];
}

export interface AgentDiscoveryOptions {
	agentDir?: string;
	globalSettingsPath?: string;
}

function isDirectory(targetPath: string): boolean {
	try {
		return fs.statSync(targetPath).isDirectory();
	} catch {
		return false;
	}
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

function normalizeForCompare(targetPath: string): string {
	const normalized = path.normalize(targetPath);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(a: string, b: string): boolean {
	return normalizeForCompare(a) === normalizeForCompare(b);
}

function isSubPath(parentPath: string, childPath: string): boolean {
	const relative = path.relative(normalizeExistingPath(parentPath), normalizeExistingPath(childPath));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getDefaultAgentDir(): string {
	return path.join(os.homedir(), ".pi", "agent");
}

function parseFrontmatter<T extends Record<string, unknown>>(content: string): { frontmatter: T; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) return { frontmatter: {} as T, body: content };

	const frontmatter: Record<string, unknown> = {};
	let currentKey: string | null = null;

	for (const rawLine of match[1].split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const listMatch = line.match(/^\s*-\s+(.*)$/);
		if (listMatch && currentKey) {
			const existing = frontmatter[currentKey];
			const values = Array.isArray(existing) ? existing : existing === undefined ? [] : [existing];
			values.push(listMatch[1].trim());
			frontmatter[currentKey] = values;
			continue;
		}

		const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!keyMatch) {
			currentKey = null;
			continue;
		}

		const [, key, rawValue] = keyMatch;
		currentKey = key;
		if (!rawValue) {
			frontmatter[key] = [];
			continue;
		}

		const value = rawValue.trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			frontmatter[key] = value.slice(1, -1);
		} else {
			frontmatter[key] = value;
		}
	}

	return { frontmatter: frontmatter as T, body: content.slice(match[0].length) };
}

function walkMarkdownFiles(dir: string): string[] {
	if (!isDirectory(dir)) return [];
	const files: string[] = [];
	const stack = [dir];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const filePath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(filePath);
				continue;
			}
			if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
				files.push(filePath);
			}
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function normalizeString(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const normalized = raw.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeLower(raw: unknown): string | undefined {
	const normalized = normalizeString(raw);
	return normalized ? normalized.toLowerCase() : undefined;
}

function parseStringList(raw: unknown): string[] | undefined {
	const values = Array.isArray(raw)
		? raw.map((value) => String(value).trim())
		: typeof raw === "string"
			? raw
				.split(/\r?\n|,/)
				.map((value) => value.replace(/^[-*]\s*/, "").trim())
			: [];
	const filtered = values.filter(Boolean);
	return filtered.length > 0 ? filtered : undefined;
}

function inferAgentClass(filePath: string, explicitClass?: string): AgentClass | undefined {
	if (explicitClass) return explicitClass;

	const lowerSegments = path.dirname(filePath).split(path.sep).map((segment) => segment.toLowerCase());
	const supported = ["research", "review", "workflow", "planning", "implementation"] as const;
	for (const candidate of supported) {
		if (lowerSegments.includes(candidate)) return candidate;
	}
	return undefined;
}

function loadAgentsFromDirRecursive(
	dir: string,
	source: AgentSource,
	sourceDetail: AgentSourceDetail,
	meta?: { packageName?: string; packageRoot?: string; discoveredFrom?: string },
): AgentConfig[] {
	const agents: AgentConfig[] = [];

	for (const filePath of walkMarkdownFiles(dir)) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
		const name = normalizeString(frontmatter.name);
		const description = normalizeString(frontmatter.description);
		if (!name || !description) continue;

		const explicitClass = normalizeLower(frontmatter.class ?? frontmatter.agent_class);

		agents.push({
			name,
			description,
			tools: parseStringList(frontmatter.tools),
			model: normalizeString(frontmatter.model),
			systemPrompt: body,
			source,
			sourceDetail,
			filePath,
			agentClass: inferAgentClass(filePath, explicitClass),
			outputFormat: normalizeLower(frontmatter.output_format ?? frontmatter.outputFormat),
			requiredSections: parseStringList(frontmatter.required_sections ?? frontmatter.requiredSections),
			strictness: normalizeLower(frontmatter.strictness),
			packageName: meta?.packageName,
			packageRoot: meta?.packageRoot,
			discoveredFrom: meta?.discoveredFrom ?? dir,
		});
	}

	return agents;
}

function findNearestProjectPiDir(cwd: string, userPiDir: string = getDefaultAgentDir()): string | null {
	const ignoredGlobalPiDir = normalizeExistingPath(path.dirname(userPiDir));
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi");
		if (isDirectory(candidate) && !samePath(normalizeExistingPath(candidate), ignoredGlobalPiDir)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function findNearestProjectAgentsDir(cwd: string, userPiDir: string): string | null {
	const piDir = findNearestProjectPiDir(cwd, userPiDir);
	if (!piDir) return null;
	const agentsDir = path.join(piDir, "agents");
	return isDirectory(agentsDir) ? agentsDir : null;
}

function findAdditionalProjectAgentDirs(cwd: string, userPiDir: string): string[] {
	const piDir = findNearestProjectPiDir(cwd, userPiDir);
	if (!piDir) return [];

	const configPath = path.join(piDir, "subagents.json");
	if (!fs.existsSync(configPath)) return [];

	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as { paths?: string[] };
		if (!Array.isArray(parsed.paths)) return [];
		return parsed.paths.map((entry) => path.resolve(piDir, entry)).filter((entry) => isDirectory(entry));
	} catch {
		return [];
	}
}

function resolveSettingsLocalPackageRoots(settingsPath: string): string[] {
	if (!fs.existsSync(settingsPath)) return [];

	try {
		const raw = fs.readFileSync(settingsPath, "utf-8");
		const parsed = JSON.parse(raw) as { packages?: unknown[] };
		if (!Array.isArray(parsed.packages)) return [];
		const settingsDir = path.dirname(settingsPath);
		const results: string[] = [];

		for (const entry of parsed.packages) {
			const source = typeof entry === "string" ? entry : typeof entry === "object" && entry ? (entry as { source?: unknown }).source : undefined;
			if (typeof source !== "string") continue;
			const trimmed = source.trim();
			if (!trimmed) continue;
			if (/^(npm:|git:|https?:\/\/|ssh:\/\/)/i.test(trimmed)) continue;
			results.push(normalizeExistingPath(path.resolve(settingsDir, trimmed)));
		}

		return results;
	} catch {
		return [];
	}
}

function classifyRegisteredPackageDir(
	entry: RegisteredPackageAgentDir,
	cwd: string,
	userPiDir: string,
	globalSettingsPath: string,
): { source: AgentSource; sourceDetail: AgentSourceDetail } {
	const projectPiDir = findNearestProjectPiDir(cwd, userPiDir);
	const projectRoot = projectPiDir ? path.dirname(projectPiDir) : null;
	const packageRoot = normalizeExistingPath(entry.packageRoot);

	if (projectPiDir) {
		const projectSettingsRoots = resolveSettingsLocalPackageRoots(path.join(projectPiDir, "settings.json"));
		if (projectSettingsRoots.some((candidate) => samePath(candidate, packageRoot))) {
			return { source: "project", sourceDetail: "project-package" };
		}
		const projectPackageStores = [path.join(projectPiDir, "npm"), path.join(projectPiDir, "git")];
		if (projectPackageStores.some((candidate) => isDirectory(candidate) && isSubPath(candidate, packageRoot))) {
			return { source: "project", sourceDetail: "project-package" };
		}
	}

	const globalSettingsRoots = resolveSettingsLocalPackageRoots(globalSettingsPath);
	if (globalSettingsRoots.some((candidate) => samePath(candidate, packageRoot))) {
		return { source: "user", sourceDetail: "user-package" };
	}

	const userPackageStores = [path.join(userPiDir, "npm"), path.join(userPiDir, "git")];
	if (userPackageStores.some((candidate) => isDirectory(candidate) && isSubPath(candidate, packageRoot))) {
		return { source: "user", sourceDetail: "user-package" };
	}

	if (projectRoot && isSubPath(projectRoot, packageRoot)) {
		return { source: "project", sourceDetail: "project-package" };
	}

	return { source: "user", sourceDetail: "user-package" };
}

function loadRegisteredPackageAgents(
	cwd: string,
	scope: AgentScope,
	options: AgentDiscoveryOptions,
): { userAgents: AgentConfig[]; projectAgents: AgentConfig[]; entries: RegisteredPackageAgentDir[] } {
	const userPiDir = options.agentDir ?? getDefaultAgentDir();
	const globalSettingsPath = options.globalSettingsPath ?? path.join(userPiDir, "settings.json");
	const entries = getRegisteredPackageAgentDirs();
	const userAgents: AgentConfig[] = [];
	const projectAgents: AgentConfig[] = [];

	for (const entry of entries) {
		const classification = classifyRegisteredPackageDir(entry, cwd, userPiDir, globalSettingsPath);
		if (scope === "user" && classification.source !== "user") continue;
		if (scope === "project" && classification.source !== "project") continue;

		const loaded = loadAgentsFromDirRecursive(entry.agentDir, classification.source, classification.sourceDetail, {
			packageName: entry.packageName,
			packageRoot: entry.packageRoot,
			discoveredFrom: entry.registeredBy ?? entry.agentDir,
		});

		if (classification.source === "project") projectAgents.push(...loaded);
		else userAgents.push(...loaded);
	}

	return { userAgents, projectAgents, entries };
}

export function formatAgentSourceTag(agent: Pick<AgentConfig, "sourceDetail" | "packageName">): string {
	return agent.packageName ? `${agent.sourceDetail}:${agent.packageName}` : agent.sourceDetail;
}

export function discoverAgents(cwd: string, scope: AgentScope, options: AgentDiscoveryOptions = {}): AgentDiscoveryResult {
	const userPiDir = options.agentDir ?? getDefaultAgentDir();
	const userDir = path.join(userPiDir, "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd, userPiDir);
	const projectConfigAgentDirs = scope === "user" ? [] : findAdditionalProjectAgentDirs(cwd, userPiDir);
	const registeredPackageAgents = loadRegisteredPackageAgents(cwd, scope, options);

	const userLocalAgents = scope === "project" ? [] : loadAgentsFromDirRecursive(userDir, "user", "user-local");
	const projectConfigAgents =
		scope === "user"
			? []
			: projectConfigAgentDirs.flatMap((dir) => loadAgentsFromDirRecursive(dir, "project", "project-config-path"));
	const projectLocalAgents =
		scope === "user" || !projectAgentsDir
			? []
			: loadAgentsFromDirRecursive(projectAgentsDir, "project", "project-local");

	const agentMap = new Map<string, AgentConfig>();
	const orderedGroups: AgentConfig[][] = [];

	if (scope !== "project") {
		orderedGroups.push(registeredPackageAgents.userAgents, userLocalAgents);
	}
	if (scope !== "user") {
		orderedGroups.push(registeredPackageAgents.projectAgents, projectConfigAgents, projectLocalAgents);
	}

	for (const group of orderedGroups) {
		for (const agent of group) {
			agentMap.set(agent.name, agent);
		}
	}

	return {
		agents: Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
		projectAgentsDir,
		projectConfigAgentDirs,
		registeredPackageAgentDirs: registeredPackageAgents.entries,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${formatAgentSourceTag(agent)}): ${agent.description}`).join("; "),
		remaining,
	};
}
