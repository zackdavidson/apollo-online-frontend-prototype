import type { Catalog } from '../catalog/catalog';
import { DEFAULT_MATERIAL_ID, isMaterialId } from '../core/materials';
import { isHexColour } from '../core/palette';
import { isCompatible } from '../core/types';
import type { ShipState } from './shipState';

const FORMAT_VERSION = 1;

interface SerializedShip {
  readonly v: number;
  readonly hull: string;
  readonly main: string;
  readonly trim: string;
  /** Material id; absent in codes from before materials existed, which read as plain. */
  readonly mat?: string;
  readonly fit: Record<string, string>;
}

/** Encode a build as a compact URL-safe string. */
export function encodeShipState(state: ShipState): string {
  const payload: SerializedShip = {
    v: FORMAT_VERSION,
    hull: state.hullId,
    main: state.colours.main,
    trim: state.colours.trim,
    mat: state.material,
    fit: { ...state.fitted },
  };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a share code, validating every reference against the catalog.
 * Unknown or incompatible attachments are dropped rather than failing the
 * whole build; an unknown hull or malformed input yields `null`.
 */
export function decodeShipState(code: string, catalog: Catalog): ShipState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(code));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['v'] !== FORMAT_VERSION) return null;

  const hull = typeof parsed['hull'] === 'string' ? catalog.findHull(parsed['hull']) : undefined;
  if (!hull) return null;
  if (!isHexColour(parsed['main']) || !isHexColour(parsed['trim'])) return null;

  const fitted: Record<string, string> = {};
  const rawFit = parsed['fit'];
  if (isRecord(rawFit)) {
    for (const slot of hull.slots) {
      const attachmentId = rawFit[slot.id];
      if (typeof attachmentId !== 'string') continue;
      const attachment = catalog.findAttachment(attachmentId);
      if (attachment && isCompatible(slot, attachment)) fitted[slot.id] = attachment.id;
    }
  }

  const material = isMaterialId(parsed['mat']) ? parsed['mat'] : DEFAULT_MATERIAL_ID;
  return { hullId: hull.id, colours: { main: parsed['main'], trim: parsed['trim'] }, material, fitted };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
