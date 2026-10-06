import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { SurfaceMesh } from '../core/mesh';
import { PALETTE_ROLES, type PaletteRole } from '../core/palette';

export type ColourResolver = (role: PaletteRole) => string;

/** Non-indexed geometry with per-vertex colours resolved from each triangle's role. */
export function buildGeometry(mesh: SurfaceMesh, colourOf: ColourResolver): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(paint(mesh, colourOf), 3));
  geometry.setAttribute('plume', new BufferAttribute(mesh.plume, 4));
  geometry.setAttribute('hullRole', new BufferAttribute(roleIndices(mesh), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Recolour an existing geometry in place without touching its shape. */
export function repaintGeometry(geometry: BufferGeometry, mesh: SurfaceMesh, colourOf: ColourResolver): void {
  const attribute = geometry.getAttribute('color');
  if (!(attribute instanceof BufferAttribute) || attribute.count !== mesh.roles.length * 3) {
    geometry.setAttribute('color', new BufferAttribute(paint(mesh, colourOf), 3));
    return;
  }
  (attribute.array as Float32Array).set(paint(mesh, colourOf));
  attribute.needsUpdate = true;
}

/** Each vertex's role as an index into PALETTE_ROLES, so the hull shader knows which surfaces wear a material. */
function roleIndices(mesh: SurfaceMesh): Float32Array {
  const indices = new Float32Array(mesh.roles.length * 3);
  mesh.roles.forEach((role, i) => {
    const index = PALETTE_ROLES.indexOf(role);
    for (let corner = 0; corner < 3; corner++) indices[i * 3 + corner] = index;
  });
  return indices;
}

function paint(mesh: SurfaceMesh, colourOf: ColourResolver): Float32Array {
  const colours = new Float32Array(mesh.roles.length * 9);
  const cache = new Map<PaletteRole, Color>();
  mesh.roles.forEach((role, i) => {
    let colour = cache.get(role);
    if (!colour) {
      colour = new Color(colourOf(role));
      cache.set(role, colour);
    }
    for (let corner = 0; corner < 3; corner++) colour.toArray(colours, (i * 3 + corner) * 3);
  });
  return colours;
}
