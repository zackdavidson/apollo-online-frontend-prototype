import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('steps back over pushes and forward again, and a push after undo drops the redo branch', () => {
    const history = new History(0);
    history.push(1);
    history.push(2);
    expect(history.present).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(1);
    history.push(5);
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
    expect(history.present).toBe(5);
  });

  it('amends the present without a step, so a drag undoes as one gesture', () => {
    const history = new History('start');
    history.push('drag-begin');
    history.replace('mid');
    history.replace('end');
    expect(history.present).toBe('end');
    expect(history.undo()).toBe('start');
    expect(history.push('start')).toBe('start');
    expect(history.canUndo).toBe(false);
  });
});
