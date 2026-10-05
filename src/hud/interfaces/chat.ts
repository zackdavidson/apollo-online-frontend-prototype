import { ValueStore } from './valueStore';

export type ChatKind = 'player' | 'system' | 'npc';

export interface ChatMessage {
  readonly from: string;
  readonly text: string;
  readonly kind: ChatKind;
  readonly colour?: string;
}

export interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
  /** Image URL for the speaker's head, shown on the left of the box. */
  readonly portrait?: string;
}

export interface DialogueScript {
  readonly lines: readonly DialogueLine[];
}

export interface DialogueState {
  readonly script: DialogueScript;
  readonly lineIndex: number;
  /** Characters of the current line revealed so far. */
  readonly revealed: number;
  readonly typing: boolean;
  /** Bumps on every open so the view can replay its pop-in animation. */
  readonly openCount: number;
}

/** Minimum seconds between lines while Space is held, so holding skips quickly without being instant. */
const HOLD_SKIP_INTERVAL = 0.14;
const MAX_LOG_LINES = 120;
/** Typewriter reveal: milliseconds per character, and the longest a line may take to finish. */
const TYPE_MS_PER_CHAR = 22;
const TYPE_MAX_MS = 1400;

/**
 * State and rules of the chat box, with no DOM: the message log, the
 * dialogue state machine (typewriter reveal, advance, hold-to-skip) and
 * the hooks the view registers for focus. Interface id 0's brain; the
 * React `ChatInterface` is its face.
 */
export class ChatController {
  readonly messages = new ValueStore<readonly ChatMessage[]>([]);
  readonly dialogue = new ValueStore<DialogueState | null>(null);
  private lastAdvanceAt = -Infinity;
  private onDone: (() => void) | null = null;
  private typeTimer: ReturnType<typeof setInterval> | null = null;
  private openCount = 0;
  private focusHandler: (() => void) | null = null;
  private typingFlag = false;

  /** `clock` returns seconds; injectable so tests can drive the hold-to-skip throttle. */
  constructor(
    private readonly callbacks: { onSend(text: string): void },
    private readonly clock: () => number = () => performance.now() / 1000,
  ) {}

  // ---- log -----------------------------------------------------------------

  addMessage(message: ChatMessage): void {
    this.messages.update((messages) => [...messages, message].slice(-MAX_LOG_LINES));
  }

  /** Called by the view when the player submits the input. */
  send(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.callbacks.onSend(trimmed);
  }

  // ---- input focus (the view wires these) ------------------------------------

  registerFocus(handler: (() => void) | null): void {
    this.focusHandler = handler;
  }

  focusInput(): void {
    this.focusHandler?.();
  }

  setTyping(typing: boolean): void {
    this.typingFlag = typing;
  }

  /** True while the chat input has keyboard focus. */
  get typing(): boolean {
    return this.typingFlag;
  }

  // ---- dialogue --------------------------------------------------------------

  get dialogueOpen(): boolean {
    return this.dialogue.get() !== null;
  }

  openDialogue(script: DialogueScript, onDone?: () => void): void {
    if (script.lines.length === 0) return;
    this.stopTyping();
    this.onDone = onDone ?? null;
    this.openCount += 1;
    this.lastAdvanceAt = this.clock();
    this.showLine(script, 0);
  }

  closeDialogue(): void {
    if (!this.dialogueOpen) return;
    this.stopTyping();
    this.dialogue.set(null);
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** Next line, or close after the last. `repeat` (a held key) is rate limited so holding Space skips smoothly. */
  advanceDialogue(repeat: boolean): void {
    const state = this.dialogue.get();
    if (!state) return;
    const at = this.clock();
    if (repeat && at - this.lastAdvanceAt < HOLD_SKIP_INTERVAL) return;
    this.lastAdvanceAt = at;
    // A line still typing finishes first; the next press moves on.
    if (state.typing) {
      this.finishTyping();
      return;
    }
    const next = state.lineIndex + 1;
    if (next >= state.script.lines.length) this.closeDialogue();
    else this.showLine(state.script, next);
  }

  dispose(): void {
    this.stopTyping();
  }

  private showLine(script: DialogueScript, lineIndex: number): void {
    const line = script.lines[lineIndex];
    if (!line) return;
    this.stopTyping();
    this.dialogue.set({ script, lineIndex, revealed: 0, typing: true, openCount: this.openCount });
    const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / Math.max(1, line.text.length));
    this.typeTimer = setInterval(() => {
      const current = this.dialogue.get();
      if (!current || current.lineIndex !== lineIndex) return this.stopTyping();
      const revealed = Math.min(line.text.length, current.revealed + 1);
      if (revealed >= line.text.length) this.finishTyping();
      else this.dialogue.set({ ...current, revealed });
    }, perChar);
    // Dialogue also lands in the log, so it can be read back later.
    this.addMessage({ from: line.speaker, text: line.text, kind: 'npc' });
  }

  private finishTyping(): void {
    this.stopTyping();
    const current = this.dialogue.get();
    if (!current) return;
    const line = current.script.lines[current.lineIndex];
    this.dialogue.set({ ...current, revealed: line?.text.length ?? 0, typing: false });
  }

  private stopTyping(): void {
    if (this.typeTimer !== null) {
      clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
  }
}
