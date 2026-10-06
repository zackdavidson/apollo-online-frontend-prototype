import { EXAMINE_OPTION, EntityType, HELD_OPTIONS, HUD_INTERFACE_IDS, LOC_OPTIONS, NPC_OPTIONS, OBJ_OPTIONS, WEAPON_GROUP_BY_INDEX, type OptionDefinition } from '../client/definitions';
import type { ClientMessage } from '../client/messages';
import { defaultItemCatalog, type ItemCatalog, type ResourceKind, type WeaponGroup } from './items';
import { ROCK_KINDS, type RockKind } from './rocks';

/**
 * Right-click menus, old-school style. Everything you can point at has a
 * list of numbered options from the definitions table; the first is the
 * default a plain click performs, and "Examine" is always last. Choosing
 * one sends the option number to the server (OPNPC, OPLOC, OPOBJ, OPHELD,
 * OPPLAYER) and the server decides what it does. This module only
 * describes the menu; it decides nothing.
 */
export interface MenuOption {
  /** The verb, e.g. "Take". */
  readonly label: string;
  /** What it applies to, e.g. "Iron ore × 2"; shown highlighted after the verb. */
  readonly target: string;
  readonly message: ClientMessage;
}

export type OptionContext =
  | { readonly kind: 'npc'; readonly index: number; readonly entityType: number; readonly name: string; readonly inTalkRange: boolean }
  | { readonly kind: 'player'; readonly index: number; readonly name: string; readonly isSelf: boolean }
  | { readonly kind: 'rock'; readonly rock: { readonly id: string; readonly kind: RockKind } }
  | { readonly kind: 'beacon'; readonly beacon: { readonly id: string; readonly label: string } }
  | { readonly kind: 'hazard'; readonly hazard: { readonly id: string; readonly label: string } }
  | { readonly kind: 'obj'; readonly item: { readonly id: number; readonly kind: ResourceKind; readonly count: number } }
  | { readonly kind: 'held'; readonly item: ResourceKind; readonly count: number; readonly slot: number }
  | { readonly kind: 'equipped'; readonly itemId: string; readonly group: WeaponGroup };

const GROUP_LABEL: Record<WeaponGroup, string> = { guns: 'Guns', beam: 'Beam', missiles: 'Missiles' };

function withExamine(target: string, options: readonly OptionDefinition[], message: (option: number) => ClientMessage): MenuOption[] {
  return [...options.map((option) => ({ label: option.label, target, message: message(option.option) })), { label: 'Examine', target, message: message(EXAMINE_OPTION) }];
}

/** The options for something, default first and Examine last. Empty when there is nothing to do with it. */
export function optionsFor(context: OptionContext, items: ItemCatalog = defaultItemCatalog()): MenuOption[] {
  switch (context.kind) {
    case 'npc': {
      // A ship's "Talk-to" only shows within talking range; the comet's "Mine" always does.
      const options = (NPC_OPTIONS[context.entityType] ?? []).filter(() => context.entityType !== EntityType.SHIP || context.inTalkRange);
      return withExamine(context.name, options, (option) => ({ type: 'op-npc', option, index: context.index }));
    }
    case 'player':
      return withExamine(context.name, [], (option) => ({ type: 'op-player', option, index: context.index }));
    case 'rock':
      return withExamine(`${ROCK_KINDS[context.rock.kind].label} rock`, LOC_OPTIONS.rock, (option) => ({ type: 'op-loc', option, locId: context.rock.id }));
    case 'beacon':
      return withExamine(context.beacon.label, LOC_OPTIONS.beacon, (option) => ({ type: 'op-loc', option, locId: context.beacon.id }));
    case 'hazard':
      return withExamine(context.hazard.label, LOC_OPTIONS.hazard, (option) => ({ type: 'op-loc', option, locId: context.hazard.id }));
    case 'obj': {
      const item = items.require(context.item.kind);
      const target = context.item.count > 1 ? `${item.name} × ${context.item.count}` : item.name;
      return withExamine(target, OBJ_OPTIONS, (option) => ({ type: 'op-obj', option, index: context.item.id }));
    }
    case 'held': {
      const item = items.require(context.item);
      const target = `${item.name} × ${context.count}`;
      // Examine first for the hold, as the old inventory did: a plain click never drops by accident.
      const [examine, ...rest] = withExamine(target, HELD_OPTIONS, (option) => ({ type: 'op-held', option, item: context.item, slot: context.slot })).reverse();
      return [examine!, ...rest.reverse()];
    }
    case 'equipped': {
      const name = items.get(context.itemId)?.name ?? context.itemId;
      return [
        { label: 'Select', target: `${GROUP_LABEL[context.group]} (${name})`, message: { type: 'if-button', interfaceId: HUD_INTERFACE_IDS.weapons, button: WEAPON_GROUP_BY_INDEX.indexOf(context.group) + 1 } },
        { label: 'Examine', target: name, message: { type: 'op-held', option: EXAMINE_OPTION, item: context.itemId, slot: 0 } },
      ];
    }
  }
}
