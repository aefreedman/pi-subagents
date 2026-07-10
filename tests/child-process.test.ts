import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { waitForChildExit } from "../extensions/child-process.ts";

class FakeChild extends EventEmitter {
	readonly signals: Array<NodeJS.Signals | number | undefined> = [];
	// This deliberately becomes true after SIGTERM, as Node's ChildProcess does.
	// It must not suppress escalation before close/error settlement.
	killed = false;

	kill(signal?: NodeJS.Signals | number): boolean {
		this.signals.push(signal);
		this.killed = true;
		return true;
	}
}

function trackedSignal(): { controller: AbortController; signal: AbortSignal; removals: () => number } {
	const controller = new AbortController();
	let removalCount = 0;
	const source = controller.signal;
	return {
		controller,
		signal: {
			get aborted() {
				return source.aborted;
			},
			addEventListener: source.addEventListener.bind(source),
			removeEventListener: (...args) => {
				removalCount++;
				source.removeEventListener(...args);
			},
		} as AbortSignal,
		removals: () => removalCount,
	};
}

{
	const child = new FakeChild();
	const { controller, signal, removals } = trackedSignal();
	let scheduled: (() => void) | undefined;
	let clearedTimers = 0;
	const result = waitForChildExit(child, {
		signal,
		setTimeoutFn: (callback) => {
			scheduled = callback;
			return "timer";
		},
		clearTimeoutFn: () => {
			clearedTimers++;
		},
	});

	controller.abort();
	assert.deepEqual(child.signals, ["SIGTERM"]);
	child.emit("error", new Error("spawn failed"));
	assert.deepEqual(await result, { exitCode: 1, wasAborted: true });
	assert.equal(clearedTimers, 1, "error settlement must cancel pending escalation");
	assert.equal(removals(), 1, "error settlement must remove the abort listener");
	assert.equal(child.listenerCount("close"), 0, "error settlement must remove the close listener");
	assert.equal(child.listenerCount("error"), 0, "error settlement must remove the error listener");
	scheduled?.();
	assert.deepEqual(child.signals, ["SIGTERM"], "a settled child must not receive SIGKILL");
}

{
	const child = new FakeChild();
	const controller = new AbortController();
	let scheduled: (() => void) | undefined;
	const result = waitForChildExit(child, {
		signal: controller.signal,
		setTimeoutFn: (callback) => {
			scheduled = callback;
			return "timer";
		},
	});

	controller.abort();
	assert.equal(child.killed, true);
	scheduled?.();
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"], "SIGKILL must wait for close/error, not proc.killed");
	child.emit("close", 137, "SIGKILL");
	assert.deepEqual(await result, { exitCode: 137, wasAborted: true });
}

console.log("pi-subagents child process lifecycle tests passed");
