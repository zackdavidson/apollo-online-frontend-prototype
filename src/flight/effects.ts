import { unpackRgb } from '../client/definitions';
import type { EntityUpdate, ServerMessage } from '../client/messages';
import type { ClientEntity, ClientWorld } from '../client/world';
import { formatHit } from '../game/damageRoll';
import type { HitMarkers, HitStyle } from '../hud/hitMarkers';
import type { GameScene } from '../scene/gameScene';
import { MISSILE_SMOKE } from './colours';
import { playGraphic } from './graphics';

/** What the effects need from the session beyond the scene. */
export interface EffectsHost {
  readonly scene: GameScene;
  readonly hitMarkers: HitMarkers;
  readonly world: ClientWorld;
  /** A line in the chat log. */
  say(text: string): void;
  /** The big centre text, for a few seconds. */
  banner(text: string): void;
  /** Public chat from an entity: over its head and in the log. */
  chat(entity: ClientEntity, text: string): void;
  snapCamera(x: number, z: number): void;
  accentFor(entity: ClientEntity): string;
}

/**
 * Flashes, bursts, hit numbers, chat bubbles and banners that follow from
 * server messages. Runs on each message *before* the world applies it, so
 * it can compare a hit with the vitals it replaces. Pure presentation:
 * nothing here changes the world.
 */
export function applyEffects(host: EffectsHost, message: ServerMessage): void {
  const { scene, hitMarkers, world } = host;
  switch (message.type) {
    case 'player-info':
    case 'npc-info':
      for (const update of message.entities) entityEffects(host, update);
      return;
    case 'map-anim':
      playGraphic(scene, message.graphic, message.x, message.z, message.scale, unpackRgb(message.rgb));
      return;
    case 'hit-splat':
      hitMarkers.spawn(message.x, 1.2, message.z, formatHit(message.amount), 'rock', message.kind);
      return;
    case 'message-game':
      if (message.kind !== 'banner') host.say(message.text);
      if (message.kind !== 'game') host.banner(message.text);
      return;
    default:
      return;
  }
  void world;
}

function entityEffects(host: EffectsHost, update: EntityUpdate): void {
  const { scene, hitMarkers, world } = host;
  const entity = world.entities.get(update.index);
  const own = update.index === world.playerIndex;
  if (update.movement?.teleport && own) host.snapCamera(update.movement.x, update.movement.z);
  if (!entity?.appearance) return;
  const { appearance } = entity;
  const isComet = entity.vitals.maxShield === 0 && appearance.hullName === '';
  if (update.hit) {
    const hit = update.hit;
    const style: HitStyle = isComet ? 'rock' : own ? 'incoming' : hit.absorbed ? 'shield' : 'hull';
    if (hit.amount > 0) hitMarkers.spawn(hit.x, 1.2, hit.z, formatHit(hit.amount), style, hit.kind);
    if (!isComet) {
      if (hit.shield < entity.vitals.shield) scene.shipShieldHit(String(entity.index), hit.x, hit.z);
      scene.flash(hit.x, hit.z, hit.hull < entity.vitals.hull ? 2.4 : 1.6);
      if (hit.hull < entity.vitals.hull) scene.burst(hit.x, hit.z, 8, 9, appearance.build.colours.trim || '#ffffff');
    }
  }
  if (update.spotAnim) {
    const { graphic, scale, rgb } = update.spotAnim;
    playGraphic(scene, graphic, entity.pose.x, entity.pose.z, scale > 0 ? scale : appearance.radius, unpackRgb(rgb), { hull: appearance.build.colours.main, accent: host.accentFor(entity) });
  }
  if (update.chat !== undefined) host.chat(entity, update.chat);
}

/** Missiles leave a thin smoke trail: one slow grey chip per frame per shot in flight. */
export function smokeTrails(scene: GameScene, world: ClientWorld): void {
  for (const projectile of world.projectiles.values()) {
    if (!projectile.weapon.trail) continue;
    const at = world.projectilePosition(projectile);
    scene.burst(at.x, at.z, 1, 1.2, MISSILE_SMOKE);
  }
}
