import { Graphics } from '../client/definitions';
import type { GameScene } from '../scene/gameScene';
import { COMET_ACCENT, NPC_ACCENT, SHIELD_COLOUR } from './colours';

/**
 * What each graphic id looks like. The server names a graphic, a place, a
 * scale and optionally a colour; the recipes here turn that into flashes,
 * bursts and shockwaves. Colours default per graphic when the server sends
 * none; `hull` and `accent` come from the entity a spot anim plays on.
 */
export interface GraphicContext {
  readonly hull?: string;
  readonly accent?: string;
}

export function playGraphic(scene: GameScene, graphic: number, x: number, z: number, scale: number, colour: string | null, context: GraphicContext = {}): void {
  const size = scale > 0 ? scale : 1;
  switch (graphic) {
    case Graphics.MUZZLE_FLASH:
      scene.flash(x, z, size);
      return;
    case Graphics.FLAK_POP:
      scene.flash(x, z, 1.3);
      scene.burst(x, z, 4, 5, colour ?? '#ffa64a');
      return;
    case Graphics.BEAM_IMPACT:
      scene.burst(x, z, 10, 9, colour ?? '#7fe3ff');
      return;
    case Graphics.SIEGE_SHOCK:
      scene.shockwave(x, z, size, colour ?? '#ff7a4a');
      return;
    case Graphics.HULL_SPARKS:
      scene.flash(x, z, 2.4);
      scene.burst(x, z, 8, 9, colour ?? context.accent ?? '#ffffff');
      return;
    case Graphics.EXPLOSION:
      scene.explode(x, z, size, colour ?? context.hull ?? '#888888', context.accent ?? NPC_ACCENT);
      return;
    case Graphics.RESPAWN:
      scene.flash(x, z, size * 3);
      scene.shockwave(x, z, size * 3, colour ?? SHIELD_COLOUR);
      return;
    case Graphics.ROCK_CHIPS:
      scene.burst(x, z, 6, 7, colour ?? '#9a8f80');
      scene.flash(x, z, 1.6);
      return;
    case Graphics.ROCK_BREAK:
      scene.burst(x, z, 14 + Math.round(size * 6), 6 + size * 2, colour ?? '#9a8f80');
      scene.flash(x, z, size * 2.5);
      if (size > 3) scene.shockwave(x, z, size * 3, '#c9b89a');
      return;
    case Graphics.ROCK_RESPAWN:
      scene.flash(x, z, size * 1.5);
      return;
    case Graphics.COMET_SPARK:
      scene.flash(x, z, 1.8);
      scene.burst(x, z, 6, 8, colour ?? COMET_ACCENT);
      return;
    case Graphics.COMET_CHUNK:
      scene.flash(x, z, 3);
      return;
    case Graphics.COMET_BURST:
      scene.burst(x, z, 120, 30, colour ?? COMET_ACCENT);
      scene.burst(x, z, 60, 18, '#ffffff');
      scene.flash(x, z, size * 6);
      scene.shockwave(x, z, size * 4, colour ?? COMET_ACCENT);
      return;
    case Graphics.PICKUP:
      scene.flash(x, z, 1.4);
      scene.burst(x, z, 5, 6, colour ?? '#ffffff');
      return;
    case Graphics.WARP_SPOOL:
      scene.shockwave(x, z, size * 2.5, colour ?? SHIELD_COLOUR);
      return;
    case Graphics.WARP_ARRIVE:
      scene.flash(x, z, size * 3.5);
      scene.shockwave(x, z, size * 3, colour ?? SHIELD_COLOUR);
      return;
    case Graphics.BEACON_PULSE:
      scene.flash(x, z, size * 0.6);
      scene.shockwave(x, z, size * 1.6, colour ?? '#ffffff');
      return;
    case Graphics.HOSTILE:
      scene.shockwave(x, z, size * 2.5, colour ?? NPC_ACCENT);
      return;
    case Graphics.GAS_PUFF:
      scene.burst(x, z, 3, 4, colour ?? '#9bff3d');
      return;
    default:
      // An id this client does not know: nothing to draw, nothing to break.
      return;
  }
}
