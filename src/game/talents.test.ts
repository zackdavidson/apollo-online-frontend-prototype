import { describe, expect, it } from 'vitest';
import { TALENTS, freshTalents, talentAssetPath, talentReadouts, totalLevel } from './talents';

describe('talents', () => {
  it('ships the eleven talents of the design, uniquely named, with an icon each', () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(10);
    expect(TALENTS.length).toBeLessThanOrEqual(15);
    expect(new Set(TALENTS.map((talent) => talent.id)).size).toBe(TALENTS.length);
    expect(TALENTS.map((talent) => talent.name)).toEqual(['Mining', 'Gas Harvesting', 'Xenobiology', 'Hunting', 'Salvaging', 'Refining', 'Chemistry', 'Engineering', 'Gunnery', 'Piloting', 'Slayer']);
    expect(TALENTS.filter((talent) => talent.group === 'gathering')).toHaveLength(5);
    const shipped = Object.keys(import.meta.glob('/public/assets/talents/*.png'));
    for (const talent of TALENTS) expect(shipped, talent.id).toContain(`/public/${talentAssetPath(talent.icon)}`);
  });

  it('stands every talent at 1/1 until a server says otherwise, and shows what the server sends', () => {
    const sheet = freshTalents();
    expect(sheet.every((standing) => standing.level === 1 && standing.base === 1)).toBe(true);
    expect(totalLevel(sheet)).toBe(TALENTS.length);
    expect(talentReadouts(sheet).map((readout) => readout.id)).toEqual(TALENTS.map((talent) => talent.id));
    const fromServer = talentReadouts([{ id: 'mining', level: 42, base: 40 }]);
    expect(fromServer.find((readout) => readout.id === 'mining')).toMatchObject({ name: 'Mining', level: 42, base: 40 });
    expect(fromServer.find((readout) => readout.id === 'gunnery')).toMatchObject({ level: 1, base: 1 });
    expect(totalLevel(fromServer)).toBe(TALENTS.length - 1 + 40);
  });
});
