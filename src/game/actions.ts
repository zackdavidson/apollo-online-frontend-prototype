import type { Beacon } from './beacons';
import type { Hazard } from './hazards';
import { defaultItemCatalog, type ItemCatalog, type ResourceKind, type WeaponGroup } from './items';
import type { Pickup } from './loot';
import { ROCK_KINDS, rockDropItems, type Rock } from './rocks';
import type { ShipEntity } from './world';

/**
 * Right-click options, old-school style. Everything you can point at has a
 * list of options; the first is the default a plain click performs. This
 * module only describes them (pure data, testable); the session carries
 * them out. Options differ by where the item is: on the ground, in the
 * hold, or fitted to the ship.
 */
export type GameAction =
  | { readonly type: 'take'; readonly pickupId: number }
  | { readonly type: 'examine'; readonly text: string }
  | { readonly type: 'mine'; readonly rockId: string }
  | { readonly type: 'mine-comet' }
  | { readonly type: 'talk'; readonly shipId: string }
  | { readonly type: 'drop'; readonly item: ResourceKind; readonly count: number }
  | { readonly type: 'select-group'; readonly group: WeaponGroup };

export interface MenuOption {
  /** The verb, e.g. "Take". */
  readonly label: string;
  /** What it applies to, e.g. "Iron ore × 2"; shown highlighted after the verb. */
  readonly target: string;
  readonly action: GameAction;
}

export type OptionContext =
  | { readonly kind: 'ground'; readonly pickup: Pickup }
  | { readonly kind: 'rock'; readonly rock: Rock }
  | { readonly kind: 'comet'; readonly hp: number; readonly maxHp: number }
  | { readonly kind: 'ship'; readonly ship: ShipEntity; readonly talkable: boolean; readonly isPlayer: boolean }
  | { readonly kind: 'beacon'; readonly beacon: Beacon }
  | { readonly kind: 'hazard'; readonly hazard: Hazard }
  | { readonly kind: 'inventory'; readonly item: ResourceKind; readonly count: number }
  | { readonly kind: 'equipped'; readonly itemId: string; readonly group: WeaponGroup };

const GROUP_LABEL: Record<WeaponGroup, string> = { guns: 'Guns', beam: 'Beam', missiles: 'Missiles' };

/** The options for something, default first. Empty when there is nothing to do with it. */
export function optionsFor(context: OptionContext, items: ItemCatalog = defaultItemCatalog()): MenuOption[] {
  switch (context.kind) {
    case 'ground': {
      const item = items.require(context.pickup.kind);
      const target = context.pickup.count > 1 ? `${item.name} × ${context.pickup.count}` : item.name;
      return [
        { label: 'Take', target, action: { type: 'take', pickupId: context.pickup.id } },
        { label: 'Examine', target, action: { type: 'examine', text: `${item.description} Worth ${item.value * context.pickup.count}.` } },
      ];
    }
    case 'rock': {
      const info = ROCK_KINDS[context.rock.kind];
      const target = `${info.label} rock`;
      const yields = rockDropItems(context.rock.kind).map((kind) => items.require(kind).name.toLowerCase()).join(' and ');
      return [
        { label: 'Mine', target, action: { type: 'mine', rockId: context.rock.id } },
        { label: 'Examine', target, action: { type: 'examine', text: `${info.description} Yields ${yields}. ${Math.ceil(context.rock.hp)} / ${context.rock.maxHp} hp.` } },
      ];
    }
    case 'comet':
      return [
        { label: 'Mine', target: 'Comet', action: { type: 'mine-comet' } },
        { label: 'Examine', target: 'Comet', action: { type: 'examine', text: `A shooting star crossing the sector; it sheds chunks as it is mined. ${Math.ceil(context.hp)} / ${context.maxHp} hp.` } },
      ];
    case 'ship': {
      const { spec, stance } = context.ship;
      const options: MenuOption[] = [];
      if (context.talkable) options.push({ label: 'Talk to', target: spec.name, action: { type: 'talk', shipId: spec.id } });
      const mood = context.isPlayer ? 'That is you.' : spec.invulnerable ? 'Nothing you have can scratch it.' : stance === 'friendly' ? 'Friendly, for now.' : 'Hostile.';
      options.push({ label: 'Examine', target: spec.name, action: { type: 'examine', text: `${spec.hullName}. ${mood}` } });
      return options;
    }
    case 'beacon':
      return [{ label: 'Examine', target: context.beacon.label, action: { type: 'examine', text: `${context.beacon.description || 'A beacon.'} Fly through it to activate.` } }];
    case 'hazard':
      return [{ label: 'Examine', target: context.hazard.label, action: { type: 'examine', text: `A gas cloud ${context.hazard.radius.toFixed(0)} units across. ${context.hazard.damagePerSecond} damage a second to anything inside.` } }];
    case 'inventory': {
      const item = items.require(context.item);
      const target = `${item.name} × ${context.count}`;
      return [
        { label: 'Examine', target, action: { type: 'examine', text: `${item.description} Worth ${item.value} each.` } },
        { label: 'Drop', target, action: { type: 'drop', item: context.item, count: context.count } },
      ];
    }
    case 'equipped': {
      const item = items.get(context.itemId);
      const name = item?.name ?? context.itemId;
      return [
        { label: 'Select', target: `${GROUP_LABEL[context.group]} (${name})`, action: { type: 'select-group', group: context.group } },
        { label: 'Examine', target: name, action: { type: 'examine', text: item?.description ?? 'Standard issue.' } },
      ];
    }
  }
}
