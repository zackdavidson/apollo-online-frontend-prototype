import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useServices, useStoreValue, type InterfaceViewProps } from './context';

/**
 * Interface 0, the chat box: a scrolling log, an input line, and, while an
 * NPC is talking, the holographic dialogue panel in place of the log. All
 * state lives in `ChatController`; this only renders it.
 */
export function ChatInterface(_: InterfaceViewProps) {
  const { chat } = useServices();
  const messages = useStoreValue(chat.messages);
  const dialogue = useStoreValue(chat.dialogue);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chat.registerFocus(() => inputRef.current?.focus());
    return () => chat.registerFocus(null);
  }, [chat]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, dialogue]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const input = event.currentTarget;
      chat.send(input.value);
      input.value = '';
      input.blur();
    },
    [chat],
  );

  const line = dialogue?.script.lines[dialogue.lineIndex];
  const last = dialogue ? dialogue.lineIndex === dialogue.script.lines.length - 1 : false;

  return (
    <div className="hud hud-chat">
      {dialogue && line ? (
        <div
          key={dialogue.openCount}
          className="dialogue dialogue-open"
          title="Space or click to continue · hold Space to skip"
          onPointerDown={(event) => {
            event.preventDefault();
            chat.advanceDialogue(false);
          }}
        >
          {line.portrait ? <img className="dialogue-portrait" src={line.portrait} alt="" /> : null}
          <div className="dialogue-body">
            <div className="dialogue-name">{line.speaker}</div>
            <div className="dialogue-text pop" key={dialogue.lineIndex}>
              {line.text.slice(0, dialogue.revealed)}
              {dialogue.typing ? <span className="dialogue-caret">▍</span> : null}
            </div>
            <div className={`dialogue-cue${dialogue.typing ? ' typing' : ''}`}>{last ? 'Space ▸ close' : 'Space ▸ continue'}</div>
          </div>
        </div>
      ) : (
        <div className="chat-log" ref={logRef}>
          {messages.map((message, index) => (
            <div key={index} className={`chat-line chat-${message.kind}`}>
              {message.kind !== 'system' ? (
                <span className="chat-from" style={message.colour ? { color: message.colour } : undefined}>
                  {message.from}:{' '}
                </span>
              ) : null}
              <span className="chat-text">{message.text}</span>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="chat-input"
        type="text"
        maxLength={160}
        autoComplete="off"
        spellCheck={false}
        placeholder="Press Enter to chat · /help for controls"
        onKeyDown={onKeyDown}
        onFocus={() => chat.setTyping(true)}
        onBlur={() => chat.setTyping(false)}
      />
    </div>
  );
}
