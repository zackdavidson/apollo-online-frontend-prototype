import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from './chat';

const script = { lines: [{ speaker: 'Nav', text: 'Hello pilot.' }, { speaker: 'Nav', text: 'Fly safe.' }] };

describe('ChatController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a bounded log and hands sent text to its callback', () => {
    const onSend = vi.fn();
    const chat = new ChatController({ onSend });
    for (let i = 0; i < 130; i++) chat.addMessage({ from: '', text: `line ${i}`, kind: 'system' });
    expect(chat.messages.get()).toHaveLength(120);
    expect(chat.messages.get()[0]?.text).toBe('line 10');
    chat.send('  hi there ');
    chat.send('   ');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hi there');
  });

  it('types lines out, completes a typing line on the first advance, then moves on, then closes', () => {
    const chat = new ChatController({ onSend: () => {} });
    const done = vi.fn();
    chat.openDialogue(script, done);
    expect(chat.dialogueOpen).toBe(true);
    expect(chat.dialogue.get()).toMatchObject({ lineIndex: 0, revealed: 0, typing: true, openCount: 1 });
    vi.advanceTimersByTime(22 * 4 + 1);
    expect(chat.dialogue.get()?.revealed).toBe(4);
    chat.advanceDialogue(false);
    expect(chat.dialogue.get()).toMatchObject({ lineIndex: 0, revealed: 'Hello pilot.'.length, typing: false });
    chat.advanceDialogue(false);
    expect(chat.dialogue.get()).toMatchObject({ lineIndex: 1, revealed: 0, typing: true });
    vi.advanceTimersByTime(5000);
    expect(chat.dialogue.get()).toMatchObject({ typing: false, revealed: 'Fly safe.'.length });
    chat.advanceDialogue(false);
    expect(chat.dialogueOpen).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    // Every line also went to the log.
    expect(chat.messages.get().map((m) => m.text)).toEqual(['Hello pilot.', 'Fly safe.']);
  });

  it('rate limits held-key repeats and lets Esc-style close fire onDone once', () => {
    let seconds = 100;
    const chat = new ChatController({ onSend: () => {} }, () => seconds);
    const done = vi.fn();
    chat.openDialogue(script, done);
    vi.advanceTimersByTime(5000); // line 0 fully typed
    const before = chat.dialogue.get()?.lineIndex;
    seconds += 0.05;
    chat.advanceDialogue(true); // a held-key repeat too soon after the open
    expect(chat.dialogue.get()?.lineIndex).toBe(before);
    seconds += 0.2;
    chat.advanceDialogue(true);
    expect(chat.dialogue.get()?.lineIndex).toBe(1);
    chat.closeDialogue();
    chat.closeDialogue();
    expect(done).toHaveBeenCalledTimes(1);
  });
});
