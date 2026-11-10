import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// Host-provided subpath: omp resolves it at runtime, so it is not a plugin dependency.
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";

const TURN_TYPE = "omp-turn-timer";
const LOG = process.env.OMP_TURN_TIMER_LOG;

function log(line: string): void {
	if (!LOG) return;
	try {
		appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
	} catch {}
}

function textKey(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `${(h >>> 0).toString(36)}:${text.length}`;
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function clock(ms: number): string {
	const d = new Date(ms);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) ms = 0;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
	const total = Math.round(s);
	const m = Math.floor(total / 60);
	const rs = total % 60;
	if (m < 60) return `${m}m ${rs}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

function textWidth(text: string): number {
	if (typeof Bun !== "undefined" && typeof Bun.stringWidth === "function") return Bun.stringWidth(text);
	let w = 0;
	for (const ch of text) w += ch.codePointAt(0)! > 0x2e80 ? 2 : 1;
	return w;
}

function fit(text: string, width: number): string {
	if (width <= 0) return "";
	if (textWidth(text) <= width) return text;
	let out = "";
	let used = 0;
	for (const ch of text) {
		const cw = textWidth(ch);
		if (used + cw > width - 1) break;
		out += ch;
		used += cw;
	}
	return `${out}…`;
}

/** Minimal pi-tui Component: one line, optionally painted by the theme. */
class TimerLine {
	constructor(
		private readonly text: string,
		private readonly paint?: (s: string) => string,
	) {}
	render(width: number): string[] {
		const line = fit(this.text, width);
		return [this.paint ? this.paint(line) : line];
	}
	isTranscriptBlockCompact(): boolean {
		return true;
	}
	invalidate(): void {}
	dispose(): void {}
}

interface Timing {
	start: number;
	end?: number;
	text: string;
}

interface TurnDetails {
	start: number;
	end: number;
	duration: number;
	toolCalls: number;
	thinkingBlocks: number;
}

export default function turnTimer(pi: ExtensionAPI) {
	// ---- turn state (per session: factory closure) ----
	let runStart: number | undefined;
	let footerToken = 0;

	// ---- per-block timing ----
	const liveThinking = new Map<number, Timing>();
	const finishedThinking = new Map<string, Timing>();
	const tools = new Map<string, { start: number; end?: number; name: string }>();

	const reset = () => {
		runStart = undefined;
		footerToken++;
		liveThinking.clear();
		finishedThinking.clear();
		tools.clear();
	};

	// Enable the opt-in presenter surface unless the user configured it.
	try {
		const setting = lookup("extensionRenderers.transcriptPresenters");
		if (setting && !setting.isConfigured(pi.pi.settings)) {
			setting.override(pi.pi.settings, true);
			log("overrode extensionRenderers.transcriptPresenters=true");
		}
	} catch (err) {
		log(`settings override skipped: ${String(err)}`);
	}

	pi.on("session_start", () => {
		reset();
		log("session_start");
	});
	pi.on("session_switch", () => reset());
	pi.on("session_branch", () => reset());

	// ---- thinking timing ----
	pi.on("message_start", event => {
		if (event.message.role === "assistant") liveThinking.clear();
	});

	pi.on("message_update", event => {
		const ev = event.assistantMessageEvent;
		if (ev.type === "thinking_start") {
			liveThinking.set(ev.contentIndex, { start: Date.now(), text: "" });
			return;
		}
		if (ev.type === "thinking_delta") {
			const block = event.message.content[ev.contentIndex];
			const timing = liveThinking.get(ev.contentIndex) ?? { start: Date.now(), text: "" };
			timing.text = block && block.type === "thinking" ? block.thinking : timing.text + ev.delta;
			liveThinking.set(ev.contentIndex, timing);
			return;
		}
		if (ev.type === "thinking_end") {
			const timing = liveThinking.get(ev.contentIndex);
			if (timing) {
				timing.end = Date.now();
				if (typeof ev.content === "string") timing.text = ev.content;
			}
		}
	});

	pi.on("message_end", event => {
		const message = event.message;
		if (message.role !== "assistant") return;
		for (let i = 0; i < message.content.length; i++) {
			const block = message.content[i];
			if (block.type !== "thinking") continue;
			const timing = liveThinking.get(i) ?? { start: message.timestamp, text: block.thinking };
			if (timing.end === undefined) timing.end = message.completedAt ?? Date.now();
			timing.text = block.thinking;
			finishedThinking.set(textKey(block.thinking.trim()), timing);
			if (finishedThinking.size > 500) {
				const oldest = finishedThinking.keys().next().value;
				if (oldest !== undefined) finishedThinking.delete(oldest);
			}
		}
		liveThinking.clear();
	});

	const lookupThinking = (text: string): Timing | undefined => {
		const key = text.trim();
		const exact = finishedThinking.get(textKey(key));
		if (exact) return exact;
		for (const timing of liveThinking.values()) {
			const raw = timing.text.trim();
			if (raw === key || raw.startsWith(key) || key.startsWith(raw)) return timing;
		}
		if (liveThinking.size === 1) return liveThinking.values().next().value;
		return undefined;
	};

	pi.registerAssistantThinkingRenderer((context, theme) => {
		const timing = lookupThinking(context.text);
		if (!timing) return undefined;
		const end = timing.end;
		const line = end
			? `⏱ ${clock(timing.start)} → ${clock(end)} · ${fmtDuration(end - timing.start)}`
			: `⏱ ${clock(timing.start)} → …`;
		return new TimerLine(line, s => theme.fg("dim", s));
	});

	// ---- tool timing ----
	pi.on("tool_execution_start", event => {
		tools.set(event.toolCallId, { start: Date.now(), name: event.toolName });
	});

	pi.on("tool_execution_end", event => {
		const timing = tools.get(event.toolCallId);
		if (timing) timing.end = Date.now();
	});

	const toolHint = (block: { toolName: string; args?: unknown }): string => {
		const args = block.args;
		if (block.toolName === "bash" && args && typeof args === "object" && "command" in args && typeof args.command === "string") {
			const first = args.command.split(/\r?\n/, 1)[0]?.trim() ?? "";
			return first.length > 60 ? `${first.slice(0, 59)}…` : first;
		}
		if (block.toolName === "eval" && args && typeof args === "object" && "language" in args && typeof args.language === "string") {
			return args.language;
		}
		if (block.toolName === "eval") return "js";
		return "";
	};

	pi.registerTranscriptPresenter(block => {
		if (block.type !== "toolCall") return undefined;
		if (block.toolName !== "bash" && block.toolName !== "eval") return undefined;
		const timing = tools.get(block.id);
		if (!timing) return undefined;
		const end = timing.end;
		const status = block.isError ? "✗" : block.isPartial || end === undefined ? "…" : "✓";
		const hint = toolHint(block);
		const label = `${status} ${block.toolName}${hint ? ` · ${hint}` : ""} · ${fmtDuration((end ?? Date.now()) - timing.start)}`;
		const rows = [
			end ? `⏱ ${clock(timing.start)} → ${clock(end)}` : `⏱ ${clock(timing.start)} → …`,
		];
		return { compact: { label, rows } };
	});

	// ---- turn footer ----
	pi.on("agent_start", () => {
		footerToken++;
		if (runStart === undefined) runStart = Date.now();
	});

	pi.on("agent_end", (event, ctx) => {
		if (ctx.agent.kind !== "main" || event.willContinue) return;
		const end = Date.now();
		const start = runStart ?? end;
		runStart = undefined;

		let toolCalls = 0;
		let thinkingBlocks = 0;
		for (const message of event.messages) {
			if (message.role !== "assistant") continue;
			for (const part of message.content) {
				if (part.type === "toolCall") toolCalls++;
				else if (part.type === "thinking") thinkingBlocks++;
			}
		}
		const duration = end - start;
		const extras = [
			toolCalls > 0 ? `工具 ${toolCalls} 次` : "",
			thinkingBlocks > 0 ? `思考 ${thinkingBlocks} 段` : "",
		].filter(Boolean);
		const content = `⏱ ${clock(start)} → ${clock(end)} · 用时 ${fmtDuration(duration)}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
		log(`agent_end idle=${ctx.isIdle()} content=${content}`);

		const token = ++footerToken;
		let attempts = 0;
		const deliver = () => {
			if (token !== footerToken || ctx.agent.kind !== "main") return;
			if (!ctx.isIdle()) {
				if (++attempts < 300) ctx.setTimeout(deliver, 100);
				return;
			}
			try {
				pi.sendMessage(
					{
						customType: TURN_TYPE,
						content,
						display: true,
						details: { start, end, duration, toolCalls, thinkingBlocks },
						attribution: "agent",
					},
					{ triggerTurn: false },
				);
				log("footer sent");
			} catch (err) {
				log(`footer failed: ${String(err)}`);
			}
		};
		deliver();
	});

	// Keep the footer out of the model context: it is display-only.
	pi.on("context", event => {
		log(`context event: ${event.messages.length} message(s)`);
		const messages = event.messages.filter(
			message => !(message.role === "custom" && message.customType === TURN_TYPE),
		);
		if (messages.length !== event.messages.length) {
			log(`context filtered ${event.messages.length - messages.length} footer message(s)`);
			return { messages };
		}
	});

	pi.registerMessageRenderer(TURN_TYPE, (message, _options, theme) => {
		// `details` is this extension's own persisted payload; the message type only knows it as unknown.
		const details = message.details as TurnDetails | undefined;
		let text = typeof message.content === "string" ? message.content : "";
		if (!text && details?.start && details?.end) {
			text = `⏱ ${clock(details.start)} → ${clock(details.end)} · 用时 ${fmtDuration(details.duration ?? details.end - details.start)}`;
		}
		return new TimerLine(text, s => theme.fg("dim", s));
	});
}
