export interface ChildProcessLike {
	kill(signal?: NodeJS.Signals | number): boolean;
	once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	once(event: "error", listener: (error: Error) => void): this;
	removeListener(event: "close" | "error", listener: (...args: any[]) => void): this;
}

export interface ChildExitWaitOptions {
	signal?: AbortSignal;
	escalationDelayMs?: number;
	setTimeoutFn?: (callback: () => void, delay: number) => unknown;
	clearTimeoutFn?: (timer: unknown) => void;
	onClose?: () => void;
	onError?: (error: Error) => void;
}

export interface ChildExitResult {
	exitCode: number;
	wasAborted: boolean;
}

/**
 * Wait for a child process while escalating an abort from SIGTERM to SIGKILL.
 *
 * `ChildProcess.killed` only indicates that a signal was sent; it does not mean
 * the process has exited. Settlement is therefore tracked from close/error.
 */
export function waitForChildExit(
	proc: ChildProcessLike,
	{
		signal,
		escalationDelayMs = 5000,
		setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
		clearTimeoutFn = (timer) => clearTimeout(timer as NodeJS.Timeout),
		onClose,
		onError,
	}: ChildExitWaitOptions = {},
): Promise<ChildExitResult> {
	return new Promise((resolve) => {
		let settled = false;
		let wasAborted = false;
		let escalationTimer: unknown | null = null;

		const cleanup = () => {
			if (escalationTimer !== null) {
				clearTimeoutFn(escalationTimer);
				escalationTimer = null;
			}
			proc.removeListener("close", handleClose);
			proc.removeListener("error", handleError);
			signal?.removeEventListener("abort", handleAbort);
		};

		const settle = (exitCode: number) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ exitCode, wasAborted });
		};

		const handleClose = (code: number | null) => {
			onClose?.();
			settle(code ?? 0);
		};

		const handleError = (error: Error) => {
			onError?.(error);
			settle(1);
		};

		const handleAbort = () => {
			if (settled || wasAborted) return;
			wasAborted = true;
			try {
				proc.kill("SIGTERM");
			} catch {
				// The process may have settled between the state check and signal.
			}
			escalationTimer = setTimeoutFn(() => {
				escalationTimer = null;
				if (settled) return;
				try {
					proc.kill("SIGKILL");
				} catch {
					// The process may have settled between the state check and signal.
				}
			}, escalationDelayMs);
		};

		proc.once("close", handleClose);
		proc.once("error", handleError);
		if (signal?.aborted) handleAbort();
		else signal?.addEventListener("abort", handleAbort, { once: true });
	});
}
