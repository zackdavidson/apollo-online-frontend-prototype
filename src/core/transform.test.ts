import { describe, expect, it } from 'vitest';
import { apply, compose, fromDirection, handedness, MIRROR_X, placement, rotationDegrees, translation } from './transform';
import { DIRECTIONS, directionVector, rotateToDirection } from './vector';

const close = (a: readonly number[], b: readonly number[]): void => {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
};

describe('transform', () => {
  it('translates', () => {
    close(apply(translation([1, 2, 3]), [1, 1, 1]), [2, 3, 4]);
  });

  it('rotates about single axes in the expected direction', () => {
    close(apply(rotationDegrees([0, 90, 0]), [0, 0, 1]), [1, 0, 0]);
    close(apply(rotationDegrees([-90, 0, 0]), [0, 0, 1]), [0, 1, 0]);
    close(apply(rotationDegrees([0, 0, 90]), [1, 0, 0]), [0, 1, 0]);
  });

  it('composes placement as rotate-then-translate', () => {
    close(apply(placement([5, 0, 0], [0, 0, 90]), [1, 0, 0]), [5, 1, 0]);
  });

  it('matches rotateToDirection for every facing', () => {
    for (const direction of DIRECTIONS) {
      close(apply(fromDirection(direction), [0, 0, 1]), directionVector(direction));
      close(apply(fromDirection(direction), [1, 2, 3]), rotateToDirection([1, 2, 3], direction));
    }
  });

  it('reports mirrored handedness', () => {
    expect(handedness(MIRROR_X)).toBe(-1);
    expect(handedness(rotationDegrees([30, 40, 50]))).toBe(1);
    expect(handedness(compose(MIRROR_X, rotationDegrees([0, 45, 0])))).toBe(-1);
  });
});
