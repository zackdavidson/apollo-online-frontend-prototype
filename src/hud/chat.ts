import { el } from '../ui/dom';

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

/** Minimum seconds between lines while Space is held, so holding skips quickly without being instant. */
const HOLD_SKIP_INTERVAL = 0.14;
const MAX_LOG_LINES = 120;
/** Typewriter reveal: milliseconds per character, and the longest a line may take to finish. */
const TYPE_MS_PER_CHAR = 22;
const TYPE_MAX_MS = 1400;

/**
 * The chat box in the bottom-left: a scrolling log, an input line, and
 * (when an NPC is talking) an old-school dialogue panel in place of the log
 * with the speaker's head on the left, their name over the text, and
 * a continue cue. Lines type themselves out; Space or a click completes a
 * line that is still typing, then advances; holding Space skips.
 */
export class ChatPanel {
  readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly dialogue: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly speaker: HTMLElement;
  private readonly text: HTMLElement;
  private readonly cue: HTMLElement;
  private script: DialogueScript | null = null;
  private lineIndex = 0;
  private lastAdvanceAt = -Infinity;
  private onDone: (() => void) | null = null;
  private typeTimer: number | null = null;
  private revealed = 0;
  private fullText = '';

  constructor(callbacks: { onSend(text: string): void }) {
    this.log = el('div', { className: 'chat-log' });
    this.input = el('input', { className: 'chat-input', type: 'text' });
    this.input.placeholder = 'Press Enter to chat · /help for controls';
    this.input.maxLength = 160;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') {
        const text = this.input.value.trim();
        this.input.value = '';
        if (text) callbacks.onSend(text);
        this.input.blur();
        event.preventDefault();
      }
      event.stopPropagation();
    });
    this.portrait = el('img', { className: 'dialogue-portrait' });
    this.portrait.alt = '';
    this.speaker = el('div', { className: 'dialogue-name' });
    this.text = el('div', { className: 'dialogue-text' });
    this.cue = el('div', { className: 'dialogue-cue', text: 'Space ▸ continue' });
    this.dialogue = el('div', { className: 'dialogue', title: 'Space or click to continue · hold Space to skip' }, [this.portrait, el('div', { className: 'dialogue-body' }, [this.speaker, this.text, this.cue])]);
    this.dialogue.style.display = 'none';
    this.dialogue.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.advanceDialogue(false);
    });
    this.root = el('div', { className: 'hud hud-chat' }, [this.log, this.dialogue, this.input]);
  }

  get typing(): boolean {
    return document.activeElement === this.input;
  }

  focusInput(): void {
    this.input.focus();
  }

  addMessage(message: ChatMessage): void {
    const line = el('div', { className: `chat-line chat-${message.kind}` });
    if (message.kind !== 'system') line.append(el('span', { className: 'chat-from', text: `${message.from}: `, style: message.colour ? { color: message.colour } : {} }));
    line.append(el('span', { className: 'chat-text', text: message.text }));
    this.log.append(line);
    while (this.log.childElementCount > MAX_LOG_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  get dialogueOpen(): boolean {
    return this.script !== null;
  }

  openDialogue(script: DialogueScript, onDone?: () => void): void {
    if (script.lines.length === 0) return;
    this.script = script;
    this.lineIndex = 0;
    this.onDone = onDone ?? null;
    this.lastAdvanceAt = performance.now() / 1000;
    this.log.style.display = 'none';
    this.dialogue.style.display = '';
    // Re-trigger the pop-in animation on every open.
    this.dialogue.classList.remove('dialogue-open');
    void this.dialogue.offsetWidth;
    this.dialogue.classList.add('dialogue-open');
    this.input.blur();
    this.showLine();
  }

  closeDialogue(): void {
    if (!this.script) return;
    this.stopTyping();
    this.script = null;
    this.dialogue.style.display = 'none';
    this.log.style.display = '';
    this.log.scrollTop = this.log.scrollHeight;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** Next line, or close after the last. `repeat` is a held-key repeat and is rate limited so holding Space skips smoothly. */
  advanceDialogue(repeat: boolean): void {
    if (!this.script) return;
    const now = performance.now() / 1000;
    if (repeat && now - this.lastAdvanceAt < HOLD_SKIP_INTERVAL) return;
    this.lastAdvanceAt = now;
    // A line still typing finishes first; the next press moves on.
    if (this.typeTimer !== null) {
      this.finishTyping();
      return;
    }
    this.lineIndex += 1;
    if (this.lineIndex >= this.script.lines.length) this.closeDialogue();
    else this.showLine();
  }

  dispose(): void {
    this.stopTyping();
  }

  private showLine(): void {
    const line = this.script?.lines[this.lineIndex];
    if (!line) return;
    this.speaker.textContent = line.speaker;
    this.portrait.style.display = line.portrait ? '' : 'none';
    if (line.portrait && this.portrait.getAttribute('src') !== line.portrait) this.portrait.src = line.portrait;
    const last = this.lineIndex === (this.script?.lines.length ?? 0) - 1;
    this.cue.textContent = last ? 'Space ▸ close' : 'Space ▸ continue';
    // Pop the new line in and type it out.
    this.text.classList.remove('pop');
    void this.text.offsetWidth;
    this.text.classList.add('pop');
    this.startTyping(line.text);
    // Dialogue also lands in the log, so it can be read back later.
    this.addMessage({ from: line.speaker, text: line.text, kind: 'npc' });
  }

  private startTyping(text: string): void {
    this.stopTyping();
    this.fullText = text;
    this.revealed = 0;
    this.cue.classList.add('typing');
    const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / Math.max(1, text.length));
    this.renderTyped();
    this.typeTimer = window.setInterval(() => {
      this.revealed = Math.min(this.fullText.length, this.revealed + 1);
      this.renderTyped();
      if (this.revealed >= this.fullText.length) this.finishTyping();
    }, perChar);
  }

  private finishTyping(): void {
    this.stopTyping();
    this.revealed = this.fullText.length;
    this.renderTyped();
  }

  private stopTyping(): void {
    if (this.typeTimer !== null) {
      window.clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    this.cue.classList.remove('typing');
  }

  private renderTyped(): void {
    const done = this.revealed >= this.fullText.length;
    this.text.replaceChildren(this.fullText.slice(0, this.revealed), ...(done ? [] : [el('span', { className: 'dialogue-caret', text: '▍' })]));
  }
}
