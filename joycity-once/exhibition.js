import * as THREE from 'three';

// All input and focus coordinates use the modeled room's canonical system:
// x = room width, y = height, z = depth from A towards B. Only this root group
// reflects Z, exactly as the architectural groups in app.js do.
const UP = new THREE.Vector3(0, 1, 0);
const RAD = Math.PI / 180;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback) => Math.max(.001, finite(value, fallback));

function box(parent, name, width, height, depth, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function plane(parent, name, width, height, material, z = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = name;
  mesh.position.z = z;
  parent.add(mesh);
  return mesh;
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function textRuns(record) {
  if (Array.isArray(record.lines)) {
    const runs = [];
    record.lines.forEach((line, index) => {
      if (index) runs.push({text: '\n'});
      if (typeof line === 'string') runs.push({text: line});
      else if (Array.isArray(line?.runs)) {
        const {runs: lineRuns, text: _text, ...style} = line;
        runs.push(...lineRuns.map(run => ({...style, ...run})));
      }
      else if (line) runs.push(line);
    });
    return runs;
  }
  return record.runs?.length ? record.runs : [{text: record.text || ''}];
}

function textCanvas(text, {fontPixels = 72, color = '#575951', padding = 12, lineHeight = 1.4, runs, fontFamily = 'serif', weight = 300, align = 'left', trackingPixels = 0} = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const familyFor = family => family === 'plex' ? '"ONCE Grotesk", "IBM Plex Sans SC", "PingFang SC", sans-serif' : family === 'mono' ? '"Menlo", "Courier New", "ONCE Grotesk", "ONCE Text", "Noto Sans CJK SC", sans-serif' : family === 'serif' ? '"Songti SC", "Noto Serif CJK SC", "STSong", serif' : '"ONCE Text", "Noto Sans CJK SC", "PingFang SC", sans-serif';
  const fontFor = run => `${run.weight || weight} ${fontPixels * positive(run.fontScale, 1)}px ${familyFor(run.fontFamily || fontFamily)}`;
  const lines = [[]];
  for (const run of runs?.length ? runs : [{text: String(text)}]) {
    String(run.text || '').replace(/\r\n?/g, '\n').split('\n').forEach((part, index) => {
      if (index) lines.push([]);
      const segment = {...run, text: part};
      context.font = fontFor(segment);
      segment.width = context.measureText(part).width + Math.max(0, [...part].length - 1) * trackingPixels;
      lines[lines.length - 1].push(segment);
    });
  }
  const lineWidths = lines.map(segments => segments.reduce((width, run) => width + run.width, 0) + Math.max(0, segments.filter(run => run.text).length - 1) * trackingPixels);
  const lineScales = lines.map(segments => Math.max(1, ...segments.map(run => positive(run.fontScale, 1))));
  const measured = Math.max(1, ...lineWidths);
  // Keep the supplied line breaks. A uniform raster scale limits texture size;
  // it does not change the text or its physical aspect ratio.
  const logicalWidth = measured + padding * 2;
  const logicalHeight = lineScales.reduce((height, scale) => height + fontPixels * lineHeight * scale, 0) + padding * 2;
  // Tight author line spacing can place a punctuation descender outside the
  // typographic advance box. Expand transparent pixels around actual ink,
  // retaining the original logical box for containment and spatial anchoring.
  const draws = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  context.textBaseline = 'alphabetic';
  const collect = (text, x, baseline, run) => {
    context.font = fontFor(run);
    const metrics = context.measureText(text);
    if (text) {
      minX = Math.min(minX, x - finite(metrics.actualBoundingBoxLeft, 0));
      maxX = Math.max(maxX, x + finite(metrics.actualBoundingBoxRight, metrics.width));
      minY = Math.min(minY, baseline - finite(metrics.actualBoundingBoxAscent, 0));
      maxY = Math.max(maxY, baseline + finite(metrics.actualBoundingBoxDescent, 0));
    }
    draws.push({text, x, baseline, run});
  };
  let y = padding;
  lines.forEach((segments, index) => {
    const lineAlign = segments.find(run => run.align)?.align || align;
    let x = padding + (lineAlign === 'center' ? (measured - lineWidths[index]) / 2 : lineAlign === 'right' ? measured - lineWidths[index] : 0);
    const baseline = y + fontPixels * lineScales[index];
    for (const run of segments) {
      context.font = fontFor(run);
      if (trackingPixels && [...run.text].length > 1) {
        let cursor = x;
        for (const character of [...run.text]) {
          collect(character, cursor, baseline, run);
          cursor += context.measureText(character).width + trackingPixels;
        }
      } else collect(run.text, x, baseline, run);
      x += run.width;
      if (run.text && segments.slice(segments.indexOf(run) + 1).some(next => next.text)) x += trackingPixels;
    }
    y += fontPixels * lineHeight * lineScales[index];
  });
  const extraLeft = minX < 1 ? Math.max(0, Math.ceil(2 - minX)) : 0;
  const extraTop = minY < 1 ? Math.max(0, Math.ceil(2 - minY)) : 0;
  const extraRight = maxX > logicalWidth - 1 ? Math.max(0, Math.ceil(maxX + 2 - logicalWidth)) : 0;
  const extraBottom = maxY > logicalHeight - 1 ? Math.max(0, Math.ceil(maxY + 2 - logicalHeight)) : 0;
  const rawWidth = logicalWidth + extraLeft + extraRight;
  const rawHeight = logicalHeight + extraTop + extraBottom;
  const rasterScale = Math.min(1, 4096 / rawWidth, 4096 / rawHeight);
  canvas.width = Math.max(2, Math.ceil(rawWidth * rasterScale));
  canvas.height = Math.max(2, Math.ceil(rawHeight * rasterScale));
  // Use the integer canvas dimensions so UV-to-metre scaling preserves the
  // declared glyph metrics exactly after the texture-size cap.
  context.scale(canvas.width / rawWidth, canvas.height / rawHeight);
  context.fillStyle = color;
  context.textBaseline = 'alphabetic';
  for (const draw of draws) {
    context.font = fontFor(draw.run);
    context.fillText(draw.text, draw.x + extraLeft, draw.baseline + extraTop);
  }
  return {canvas, rawWidth, rawHeight, logicalWidth, logicalHeight, fontPixels,
    centerOffsetX: (extraRight - extraLeft) / 2,
    centerOffsetY: (extraTop - extraBottom) / 2,
    inkPadding: {left: extraLeft, top: extraTop, right: extraRight, bottom: extraBottom}};
}

// Deterministic, low-poly material markers. Broad folded ribbons, alternating
// leaf nodes and a few husked cobs distinguish dry maize from reed bouquets.
// Parts are merged by material to keep the botanical groups inexpensive.
function botanicalGeometry(record) {
  const height = positive(record.height, 1.65), width = positive(record.width, .55);
  const stalkCount = THREE.MathUtils.clamp(Math.round(finite(record.stalkCount, 3)), 1, 8);
  const earCount = THREE.MathUtils.clamp(Math.round(finite(record.earCount, 1)), 0, Math.min(stalkCount, 3));
  let seed = finite(record.seed, 31) >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const parts = Object.fromEntries(['stem', 'joint', 'leaf', 'ear'].map(kind => [kind, {kind, vertices: [], indices: []}]));
  const add = (kind, vertices, indices) => {
    const part = parts[kind], offset = part.vertices.length / 3;
    vertices.forEach(vertex => part.vertices.push(...vertex));
    part.indices.push(...indices.map(index => index + offset));
  };
  const lathe = (kind, a, b, radii, sides = 8) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const axis = end.clone().sub(start).normalize();
    const reference = Math.abs(axis.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = axis.clone().cross(reference).normalize(), v = axis.clone().cross(u).normalize();
    const vertices = [], indices = [];
    radii.forEach((radius, ring) => {
      const center = start.clone().lerp(end, ring / (radii.length - 1));
      for (let j = 0; j < sides; j++) {
        const angle = j * Math.PI * 2 / sides;
        vertices.push(center.clone().addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius).toArray());
      }
    });
    for (let ring = 0; ring < radii.length - 1; ring++) for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides, p = ring * sides, q = (ring + 1) * sides;
      indices.push(p + j, p + n, q + n, p + j, q + n, q + j);
    }
    const bottom = vertices.length; vertices.push(a);
    const top = vertices.length; vertices.push(b);
    for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides, q = (radii.length - 1) * sides;
      indices.push(bottom, n, j, top, q + j, q + n);
    }
    add(kind, vertices, indices);
  };
  const leaf = (base, angle, length, breadth, twist, phase, kind = 'leaf') => {
    const direction = [Math.cos(angle), Math.sin(angle)], lateral = [-direction[1], direction[0]];
    const vertices = [], indices = [], steps = 12;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, reach = length * (.92 * t - .32 * t * t);
      const drop = Math.min(length * .76, Math.max(.015, base[1] - .035)) * t * t;
      const rise = length * .22 * Math.sin(Math.PI * t);
      const wave = length * .045 * Math.sin(3 * Math.PI * t + phase) * t;
      const half = breadth / 2 * (.03 + .97 * Math.pow(Math.sin(Math.PI * t), .55));
      const turn = twist * (t - .1);
      for (const side of [-1, 0, 1]) vertices.push([
        base[0] + direction[0] * reach + lateral[0] * (wave + side * half * Math.cos(turn)),
        base[1] + rise - drop + side * half * Math.sin(turn) - Math.abs(side) * half * .16,
        base[2] + direction[1] * reach + lateral[1] * (wave + side * half * Math.cos(turn)),
      ]);
    }
    for (let j = 0; j < steps; j++) for (let side = 0; side < 2; side++) {
      const p = j * 3 + side, q = (j + 1) * 3 + side;
      indices.push(p, q, q + 1, p, q + 1, p + 1);
    }
    add(kind, vertices, indices);
  };
  let leafCount = 0;
  for (let stalk = 0; stalk < stalkCount; stalk++) {
    const h = stalk === 0 ? height : height * (.8 + random() * .18);
    const phase = random() * Math.PI * 2, spread = width * .14 * Math.sqrt(random());
    const foot = [Math.cos(phase) * spread, Math.sin(phase) * spread];
    const lean = [width * .12 * (random() - .5), width * .12 * (random() - .5)];
    const segments = 7, radius = THREE.MathUtils.clamp(height * .007, .008, .018), nodes = [];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      nodes.push([foot[0] + lean[0] * t + Math.sin(Math.PI * t) * width * .018, h * t, foot[1] + lean[1] * t]);
    }
    for (let j = 0; j < segments; j++) lathe('stem', nodes[j], nodes[j + 1], [radius * (1 - j / segments * .55), radius * (1 - (j + 1) / segments * .55)]);
    for (let j = 1; j < segments; j++) {
      const node = nodes[j], r = radius * (1 - j / segments * .55) * 1.28;
      lathe('joint', [node[0], node[1] - height * .005, node[2]], [node[0], node[1] + height * .005, node[2]], [r, r]);
    }
    for (let j = 1; j <= 5; j++) {
      const length = height * (.22 + random() * .13), breadth = length * (.14 + random() * .07);
      leaf(nodes[j], phase + j * Math.PI + (random() - .5) * .55, length, breadth, (random() - .5) * 2.2, random() * Math.PI * 2);
      leafCount++;
    }
    if (stalk < earCount) {
      const base = nodes[4], angle = phase + Math.PI * .35;
      const end = [base[0] + Math.cos(angle) * height * .045, base[1] + height * .115, base[2] + Math.sin(angle) * height * .045];
      const r = height * .018;
      lathe('ear', base, end, [.16 * r, .8 * r, r, .9 * r, .55 * r, .12 * r]);
      leaf(base, angle + .4, height * .145, height * .024, .9, phase, 'ear');
      leaf(base, angle - .6, height * .13, height * .02, -.8, phase + 1, 'ear');
    }
  }
  const all = Object.values(parts).flatMap(part => {
    const points = [];
    for (let i = 0; i < part.vertices.length; i += 3) points.push(part.vertices.slice(i, i + 3));
    return points;
  });
  const min = [0, 1, 2].map(axis => Math.min(...all.map(p => p[axis]))), max = [0, 1, 2].map(axis => Math.max(...all.map(p => p[axis])));
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const radius = Math.max(...all.map(p => Math.hypot(p[0] - cx, p[2] - cz)));
  const horizontalScale = width / (radius * 2), verticalScale = height / (max[1] - min[1]);
  const angle = finite(record.yaw, 0) * RAD, c = Math.cos(angle), s = Math.sin(angle);
  for (const part of Object.values(parts)) for (let i = 0; i < part.vertices.length; i += 3) {
    const x = (part.vertices[i] - cx) * horizontalScale, z = (part.vertices[i + 2] - cz) * horizontalScale;
    part.vertices[i] = c * x - s * z;
    part.vertices[i + 1] = (part.vertices[i + 1] - min[1]) * verticalScale;
    part.vertices[i + 2] = s * x + c * z;
  }
  return {parts: Object.values(parts).filter(part => part.vertices.length), stalkCount, leafCount, earCount, height, width};
}

function messageTexture(message) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#dadbd6';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#666b61';
  context.font = '22px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(message, canvas.width / 2, canvas.height / 2);
  return canvasTexture(canvas);
}

function normalizeSurface(surface) {
  const a = [finite(surface.a?.[0], 0), finite(surface.a?.[1], 0)];
  const b = [finite(surface.b?.[0], 0), finite(surface.b?.[1], 0)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-7) return null;
  const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  let normal = surface.normal || [-direction[1], direction[0]];
  const normalLength = Math.hypot(normal[0], normal[1]);
  if (normalLength < 1e-7) normal = [-direction[1], direction[0]];
  else normal = [normal[0] / normalLength, normal[1] / normalLength];
  return {...surface, a, b, length, direction, normal};
}

function faceGroup(parent, name, position, normal) {
  const group = new THREE.Group();
  group.name = name;
  // Mirror-free image basis. Canonical X = [-nz, 0, nx] has determinant -1
  // together with Y up and Z = normal. The root's Z reflection cancels that
  // determinant, so the original source UVs read correctly from the front.
  const right = new THREE.Vector3(-normal[1], 0, normal[0]);
  const front = new THREE.Vector3(normal[0], 0, normal[1]);
  group.matrix.makeBasis(right, UP, front);
  group.matrix.setPosition(...position);
  group.matrix.decompose(group.position, group.quaternion, group.scale);
  group.matrixAutoUpdate = false;
  parent.add(group);
  return group;
}

function markWork(group, work, item) {
  group.userData = {...group.userData, workId: work.id, catalogId: work.catalogId, type: work.type, layout: work, catalog: item};
  group.traverse(object => {
    object.userData.workId = work.id;
    object.userData.catalogId = work.catalogId;
  });
}

function labelForWork(group, title, width, height, depth, stats) {
  if (!title) return;
  const raster = textCanvas(title, {fontPixels: 64, padding: 5, lineHeight: 1.15});
  const physicalHeight = .022;
  const physicalWidth = Math.min(.46, physicalHeight * raster.rawWidth / raster.rawHeight);
  const actualHeight = physicalWidth * raster.rawHeight / raster.rawWidth;
  const material = new THREE.MeshBasicMaterial({
    map: canvasTexture(raster.canvas), transparent: true, opacity: 1,
    side: THREE.DoubleSide, toneMapped: false, depthWrite: false,
  });
  const label = plane(group, '小号作品编号', physicalWidth, actualHeight, material, Math.max(.003, depth * .3));
  label.position.x = width / 2 - physicalWidth / 2;
  label.position.y = -height / 2 - actualHeight / 2 - .026;
  label.userData = {role: 'proximityLabel', notArtwork: true, physicalDimensions: false};
  const worldPosition = new THREE.Vector3();
  label.onBeforeRender = (_renderer, _scene, camera) => {
    label.getWorldPosition(worldPosition);
    const distance = camera.position.distanceTo(worldPosition);
    material.opacity = 1 - THREE.MathUtils.smoothstep(distance, 3.5, 6);
  };
  stats.labels++;
}

function segmentRect(id, type, a, b, thickness) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = length ? Math.abs((b[1] - a[1]) / length) : 1;
  const nz = length ? Math.abs((b[0] - a[0]) / length) : 1;
  return {
    id, type,
    minX: Math.min(a[0], b[0]) - nx * thickness / 2,
    maxX: Math.max(a[0], b[0]) + nx * thickness / 2,
    minZ: Math.min(a[1], b[1]) - nz * thickness / 2,
    maxZ: Math.max(a[1], b[1]) + nz * thickness / 2,
  };
}

// A pair of independent clamp racks, based on the user's photographs. Long
// bottom rails run across the pane normal; the pair is spaced along its width.
// Every size is illustrative. Edge placement keeps upright metal outside the
// artwork rectangle; only soft pads overlap its edge. Earlier trials retain
// their inset racks and raised bearing when explicitly selected.
function tileClampGeometry(record, paneWidth, paneHeight, bottom) {
  const tube = positive(record.supportTube, .03), depth = positive(record.supportDepth, .52);
  const height = Math.max(positive(record.supportHeight, .42), bottom + .22);
  const placement = record.supportPlacement || 'edge', edge = placement === 'edge';
  const edgeClearance = THREE.MathUtils.clamp(finite(record.supportEdgeClearance, .002), 0, .006);
  const spacing = edge ? paneWidth + tube + edgeClearance * 2 : positive(record.supportSpacing, paneWidth * .62);
  const beamHeight = edge ? Math.min(tube, Math.max(.001, bottom - .003)) : tube;
  const bearingPadHeight = edge ? bottom - beamHeight : .01, bearingPadWidth = edge ? .045 : .075, cy = bottom + paneHeight / 2;
  const postZ = tube * 1.5, paneHalf = .005, padDepth = .008, padRadius = .025;
  const lower = bottom + .055, upper = Math.max(lower + .1, height - .065);
  const parts = Object.fromEntries(['metal', 'screw', 'rubber'].map(kind => [kind, {kind, vertices: [], indices: []}]));
  const add = (kind, vertices, indices) => {
    const part = parts[kind], offset = part.vertices.length / 3;
    vertices.forEach(vertex => part.vertices.push(vertex[0], vertex[1] - cy, vertex[2]));
    part.indices.push(...indices.map(index => offset + index));
  };
  const cube = (kind, w, h, d, center, rx = 0, rz = 0) => {
    const vertices = [], c = Math.cos(rx), s = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
    for (const z of [-d / 2, d / 2]) for (const y of [-h / 2, h / 2]) for (const x of [-w / 2, w / 2]) {
      const yy = c * y - s * z, zz = s * y + c * z;
      vertices.push([center[0] + cz * x - sz * yy, center[1] + sz * x + cz * yy, center[2] + zz]);
    }
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    add(kind, vertices, quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
  };
  const cylinder = (kind, radius, length, center, sides = 12, ridges = false) => {
    const vertices = [], indices = [], rings = ridges ? 13 : 2;
    for (let ring = 0; ring < rings; ring++) for (let j = 0; j < sides; j++) {
      const angle = j * Math.PI * 2 / sides, r = radius + (ridges && ring % 2 ? .0008 : 0);
      vertices.push([center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r, center[2] - length / 2 + length * ring / (rings - 1)]);
    }
    for (let ring = 0; ring < rings - 1; ring++) for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides, p = ring * sides, q = (ring + 1) * sides;
      indices.push(p + j, p + n, q + n, p + j, q + n, q + j);
    }
    const a = vertices.length; vertices.push([center[0], center[1], center[2] - length / 2]);
    const b = vertices.length; vertices.push([center[0], center[1], center[2] + length / 2]);
    for (let j = 0; j < sides; j++) {const n = (j + 1) % sides, q = (rings - 1) * sides; indices.push(a, n, j, b, q + j, q + n);}
    add(kind, vertices, indices);
  };
  for (const station of [-1, 1]) {
    const x = station * spacing / 2;
    cube('metal', .045, beamHeight, depth, [x, beamHeight / 2, 0]);
    for (const side of [-1, 1]) {
      cube('metal', tube, height - beamHeight, tube, [x, (height + beamHeight) / 2, side * postZ]);
      const a = [x, beamHeight / 2, side * (depth / 2 - tube / 2)], b = [x, height * .6, side * postZ];
      const dy = b[1] - a[1], dz = b[2] - a[2];
      cube('metal', tube, Math.hypot(dy, dz), tube, [x, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], Math.atan2(dz, dy));
      for (const y of [lower, upper]) {
        const inner = paneHalf + padDepth, outer = postZ + tube / 2 + .027;
        cylinder('screw', .0045, outer - inner, [x, y, side * (outer + inner) / 2], 8, true);
        cylinder('rubber', padRadius, padDepth, [x, y, side * (paneHalf + padDepth / 2)]);
        cylinder('metal', .0105, .009, [x, y, side * (postZ + tube / 2 + .006)], 6);
        for (const wing of [-1, 1]) {
          if (edge) cube('metal', .007, .023, .009, [x, y + wing * .010, side * outer], 0, wing * .45);
          else cube('metal', .023, .007, .009, [x + wing * .010, y + .002, side * outer], 0, wing * .45);
        }
      }
    }
    if (!edge) cube('metal', .075, tube, postZ * 2 + tube, [x, bottom - .01 - tube / 2, 0]);
    cube('rubber', bearingPadWidth, bearingPadHeight, .065, [x, bottom - bearingPadHeight / 2, 0]);
  }
  return {parts: Object.values(parts), count: 2, postCount: 4, braceCount: 4, clampPadCount: 8, bearingPadCount: 2, depth, height, tube, spacing, placement, edgeClearance: edge ? edgeClearance : null, beamHeight, bearingPadHeight, bearingPadWidth, raisedBearing: !edge, footprintWidth: Math.max(paneWidth, spacing + Math.max(.045, padRadius * 2, bearingPadWidth)), bearingElevation: bottom, clampLevels: [lower, upper], dimensionsStatus: 'illustrative, not measured'};
}

/**
 * Verifies optional shared-text metadata, then builds geometry. Await the
 * returned ready promise when image previews must all be loaded; navigation
 * can start beforehand.
 * works Map values are THREE.Group objects; surfaces Map values are normalized
 * canonical descriptors. focusTarget() always returns canonical coordinates.
 */
export async function buildExhibition({scene, renderer, layout = {}, catalog = {}, layoutSHA256, layoutSourceText}) {
  const poetryRasters = new Map();
  let poetryRasterEvidence = null;
  if (layout.poetryRasterManifest) {
    const baseURL = globalThis.document?.baseURI || globalThis.location?.href || 'http://localhost/';
    const manifestURL = new URL(layout.poetryRasterManifest, baseURL);
    const manifestResponse = await fetch(manifestURL, {cache: 'no-store'});
    if (!manifestResponse.ok) throw new Error(`诗句清单读取失败 (${manifestResponse.status})`);
    const manifest = await manifestResponse.json();
    let sourceSHA = layoutSHA256;
    if (!sourceSHA) {
      let bytes;
      if (typeof layoutSourceText === 'string') bytes = new TextEncoder().encode(layoutSourceText);
      else {
        const layoutResponse = await fetch(new URL('layout.json', baseURL), {cache: 'no-store'});
        if (!layoutResponse.ok) throw new Error('无法核对诗句布局文件');
        bytes = await layoutResponse.arrayBuffer();
      }
      if (!globalThis.crypto?.subtle) throw new Error('无法进行诗句布局校验');
      sourceSHA = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    if (manifest.sourceLayoutSHA256 !== sourceSHA) throw new Error('诗句清单与布局版本不一致');
    for (const item of manifest.items || []) {
      if (poetryRasters.has(item.id)) throw new Error(`诗句清单编号重复: ${item.id}`);
      const imageURL = item.imageUrl || item.url || item.file;
      if (!imageURL || !(item.physicalWidth > 0 || item.width > 0) || !(item.physicalHeight > 0 || item.height > 0)) throw new Error(`诗句清单尺寸或图像无效: ${item.id}`);
      poetryRasters.set(item.id, {...item, imageUrl: new URL(imageURL, manifestURL).href});
    }
    for (const poem of layout.poems || []) {
      const item = poetryRasters.get(poem.id);
      if (!item) throw new Error(`诗句清单缺少: ${poem.id}`);
      if (item.text != null && item.text !== textRuns(poem).map(run => run.text || '').join('')) throw new Error(`诗句清单原文不一致: ${poem.id}`);
    }
    poetryRasterEvidence = {source: manifestURL.href, sourceLayoutSHA256: sourceSHA, count: poetryRasters.size};
  }
  const group = new THREE.Group();
  group.name = '首轮策展试排_全部尺寸以布展复核为准';
  group.scale.z = -1;
  group.userData = {revision: layout.revision, status: layout.status, coordinateSpace: 'canonical', trial: true, poetryRasterManifest: poetryRasterEvidence};
  scene?.add(group);

  const surfaces = new Map();
  const works = new Map();
  const environmentFields = new Map();
  const poemGroups = new Map();
  const botanicalGroups = new Map();
  const textScreens = new Map();
  const collisionRects = [];
  const focus = new Map();
  const pending = [];
  const stats = {
    works: 0, workCount: 0, photos: 0, large: 0, videos: 0, glass: 0, texts: 0,
    partitions: 0, surfaces: 0, poems: 0, labels: 0, wallFields: 0, floorFields: 0,
    botanicalGroups: 0, stalks: 0, leaves: 0, ears: 0, textScreens: 0, tileClampRacks: 0, clampPads: 0, poemRasters: 0, textScales: [],
    textures: 0, loaded: 0, errors: 0, pending: 0, texturePixels: 0, textureResamples: 0,
    failures: [], warnings: [], aspectAdjustments: [], ready: false,
  };
  const items = catalog instanceof Map ? catalog : new Map((Array.isArray(catalog) ? catalog : catalog.items || []).map(item => [item.id, item]));
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 1, 8);
  const poetryTextureCap = globalThis.matchMedia?.('(pointer: coarse), (max-width: 760px)')?.matches ? 2048 : 4096;
  stats.poetryTextureCap = poetryTextureCap;
  const loadingTexture = messageTexture('图像载入中');
  let errorTexture;
  const white = new THREE.MeshStandardMaterial({color: '#f2f1ec', roughness: .86, side: THREE.DoubleSide});
  const backing = new THREE.MeshStandardMaterial({color: '#e5e3dc', roughness: .9, side: THREE.DoubleSide});
  const textFamily = (record, fallback = 'serif') => /trial0[45]/.test(String(layout.revision || '')) && (!record.fontFamily || record.fontFamily === 'sans') ? 'plex' : record.fontFamily || fallback;

  function register(record, object, item, position, normal, dimensions) {
    works.set(record.id, object);
    markWork(object, record, item);
    object.userData.canonicalPosition = [...position];
    object.userData.canonicalNormal = [...normal];
    focus.set(record.id, {position, normal, dimensions});
    stats.works++;
    stats.workCount = stats.works;
  }

  function imageOn(object, item, record, width, height, z, {opacity = 1, alpha = false, preserveDimensions = false, maxTextureSide: textureLimit} = {}) {
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff', map: loadingTexture, side: THREE.DoubleSide,
      toneMapped: false, transparent: alpha || opacity < 1, opacity,
      depthWrite: !alpha && opacity === 1,
    });
    const image = plane(object, '原始图像_完整比例', width, height, material, z);
    const src = record.imageUrl || record.image || (record.type === 'photo' ? item?.detailImage : null) || item?.image || item?.preview || item?.previewImage;
    image.userData.source = src || null;
    image.userData.slotDimensions = [width, height];
    stats.textures++;
    stats.pending++;
    const task = new Promise(resolve => {
      const fail = error => {
        errorTexture ||= messageTexture('图像未能载入');
        material.map = errorTexture;
        material.needsUpdate = true;
        image.name = '图像读取失败_灰色占位';
        image.userData.loadError = true;
        stats.errors++;
        stats.pending--;
        stats.failures.push({id: record.id, catalogId: record.catalogId, source: src || null, message: error?.message || '图像读取失败'});
        resolve();
      };
      if (!src || typeof src !== 'string') {
        fail(new Error('作品目录未提供预览图'));
        return;
      }
      loader.load(src, texture => {
        const nativeWidth = texture.image?.naturalWidth || texture.image?.width;
        const nativeHeight = texture.image?.naturalHeight || texture.image?.height;
        if (!nativeWidth || !nativeHeight) {
          texture.dispose();
          fail(new Error('图像像素尺寸无效'));
          return;
        }
        // Read the complete higher-quality source, then bound GPU memory for
        // desktop and mobile. Resampling affects texture resolution only.
        let textureWidth = nativeWidth, textureHeight = nativeHeight;
        const maxTextureSide = Math.min(textureLimit || (record.type === 'photo' ? 1024 : 2048), renderer?.capabilities?.maxTextureSize || 4096);
        if (Math.max(nativeWidth, nativeHeight) > maxTextureSide) {
          const factor = maxTextureSide / Math.max(nativeWidth, nativeHeight);
          const canvas = document.createElement('canvas');
          canvas.width = textureWidth = Math.max(1, Math.round(nativeWidth * factor));
          canvas.height = textureHeight = Math.max(1, Math.round(nativeHeight * factor));
          canvas.getContext('2d').drawImage(texture.image, 0, 0, canvas.width, canvas.height);
          texture.dispose();
          texture = new THREE.CanvasTexture(canvas);
          stats.textureResamples++;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        stats.texturePixels += textureWidth * textureHeight;
        image.userData.texturePixels = [textureWidth, textureHeight];
        // Contain the complete source within the declared image slot. A source
        // ratio discrepancy exposes more mat; it never crops or stretches art.
        const ratio = nativeWidth / nativeHeight;
        const renderedWidth = preserveDimensions ? width : Math.min(width, height * ratio);
        const renderedHeight = preserveDimensions ? height : renderedWidth / ratio;
        image.scale.set(renderedWidth / width, renderedHeight / height, 1);
        image.userData.nativePixels = [nativeWidth, nativeHeight];
        image.userData.renderedDimensions = [renderedWidth, renderedHeight];
        if (!preserveDimensions && Math.abs(width / height / ratio - 1) > .012) {
          stats.aspectAdjustments.push({id: record.id, declared: [width, height], rendered: [renderedWidth, renderedHeight], nativePixels: [nativeWidth, nativeHeight]});
        }
        material.map = texture;
        material.needsUpdate = true;
        stats.loaded++;
        stats.pending--;
        resolve();
      }, undefined, fail);
    });
    pending.push(task);
    return image;
  }

  for (const partition of layout.partitions || []) {
    const normalized = normalizeSurface(partition);
    if (!normalized) {
      stats.warnings.push(`无效隔墙：${partition.id}`);
      continue;
    }
    const {a, b, length, direction} = normalized;
    const height = positive(partition.height, 2.6);
    const thickness = positive(partition.thickness, .12);
    const mesh = box(group, `试排隔墙_${partition.id}`, length, height, thickness, (a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2, white);
    mesh.rotation.y = -Math.atan2(direction[1], direction[0]);
    mesh.userData = {partitionId: partition.id, trial: true, layout: partition};
    collisionRects.push(segmentRect(partition.id, 'partition', a, b, thickness));
    stats.partitions++;
  }

  for (const surface of layout.surfaces || []) {
    const normalized = normalizeSurface(surface);
    if (normalized) surfaces.set(surface.id, normalized);
    else stats.warnings.push(`无效挂画面：${surface.id}`);
  }
  stats.surfaces = surfaces.size;

  for (const field of layout.environment?.wallFields || []) {
    const surface = surfaces.get(field.surfaceId);
    if (!surface) {
      stats.warnings.push(`色墙 ${field.id} 缺少挂画面 ${field.surfaceId}`);
      continue;
    }
    const start = finite(field.alongStart, 0), end = finite(field.alongEnd, surface.length);
    if (end <= start) continue;
    const middle = (start + end) / 2, height = positive(field.height, surface.height || 2.95);
    const {a, direction, normal} = surface;
    const center = [a[0] + direction[0] * middle + normal[0] * .004, finite(field.bottom, 0) + height / 2,
      a[1] + direction[1] * middle + normal[1] * .004];
    const fieldGroup = faceGroup(group, `墙面试色_${field.id}`, center, normal);
    fieldGroup.userData = {environmentId: field.id, kind: 'wallField', layout: field, canonicalPosition: center, canonicalNormal: [...normal], surface};
    plane(fieldGroup, '墙面试色_画作之后', end - start, height,
      new THREE.MeshBasicMaterial({color: field.color || '#dfe4dc', side: THREE.DoubleSide, toneMapped: false}));
    environmentFields.set(field.id, fieldGroup);
    stats.wallFields++;
  }
  for (const field of layout.environment?.floorFields || []) {
    if (!Array.isArray(field.points) || field.points.length < 3) continue;
    const shape = new THREE.Shape();
    field.points.forEach((point, index) => index ? shape.lineTo(point[0], point[1]) : shape.moveTo(point[0], point[1]));
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({color: field.color || '#bbc4bc', transparent: true,
      opacity: THREE.MathUtils.clamp(finite(field.opacity, .6), 0, 1), side: THREE.DoubleSide,
      toneMapped: false, depthWrite: false});
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `地面试色_沿现有金属线_${field.id}`;
    mesh.position.y = .0009;
    mesh.userData = {environmentId: field.id, kind: 'floorField', layout: field};
    group.add(mesh);
    environmentFields.set(field.id, mesh);
    stats.floorFields++;
  }

  for (const record of layout.works || []) {
    const surface = surfaces.get(record.surfaceId);
    if (!surface) {
      stats.warnings.push(`作品 ${record.id} 缺少挂画面 ${record.surfaceId}`);
      continue;
    }
    const item = items.get(record.catalogId);
    const {a, direction, normal} = surface;
    const center = [a[0] + direction[0] * finite(record.along, 0) + normal[0] * .025, finite(record.centerY, 1.5), a[1] + direction[1] * finite(record.along, 0) + normal[1] * .025];
    const work = faceGroup(group, `作品_${record.id}`, center, normal);
    const imageWidth = positive(record.imageWidth, record.type === 'video' ? 1.22 : .6);
    const imageHeight = positive(record.imageHeight, record.type === 'video' ? imageWidth * 9 / 16 : .5);
    const width = positive(record.outerWidth ?? record.width, record.type === 'text' ? .9 : imageWidth + (record.type === 'video' ? .035 : .1));
    const height = positive(record.outerHeight ?? record.height, record.type === 'text' ? 1.45 : imageHeight + (record.type === 'video' ? .035 : .1));
    const depth = positive(record.depth, record.type === 'video' ? .055 : .035);

    if (record.type === 'text') {
      const paper = new THREE.MeshBasicMaterial({color: record.matColor || '#f8f7f2', side: THREE.DoubleSide, toneMapped: false});
      box(work, '前言版面_排版待核', width, height, .008, 0, 0, .004, paper);
      const fontSize = positive(record.fontSize, .045);
      const raster = textCanvas(record.text || '', {fontPixels: 96, padding: 5, color: record.color || '#42473e', runs: textRuns(record), lineHeight: finite(record.fontLineHeight, finite(record.lineHeight, 1.6)), fontFamily: textFamily(record), weight: record.weight || 300, align: record.align || 'left', trackingPixels: finite(record.letterSpacing, 0) / fontSize * 96});
      const widthScale = THREE.MathUtils.clamp(finite(record.fontWidthScale, 1), .001, 1);
      const naturalWidth = raster.logicalWidth / raster.fontPixels * fontSize * widthScale, naturalHeight = raster.logicalHeight / raster.fontPixels * fontSize;
      const contain = Math.min(1, Math.max(.001, width - .12) / naturalWidth, record.align === 'center' ? Math.max(.001, height - .04) / naturalHeight : Infinity);
      const textWidth = raster.rawWidth / raster.fontPixels * fontSize * widthScale * contain, textHeight = raster.rawHeight / raster.fontPixels * fontSize * contain;
      const centerOffsetX = raster.centerOffsetX / raster.fontPixels * fontSize * widthScale * contain, centerOffsetY = raster.centerOffsetY / raster.fontPixels * fontSize * contain;
      const material = new THREE.MeshBasicMaterial({map: canvasTexture(raster.canvas), transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false});
      const text = plane(work, '前言原文_不增写内容', textWidth, textHeight, material, .009);
      text.position.x = (record.align === 'center' ? 0 : record.align === 'right' ? width / 2 - .06 - naturalWidth * contain / 2 : -width / 2 + .06 + naturalWidth * contain / 2) + centerOffsetX;
      text.position.y = (record.align === 'center' ? 0 : height / 2 - .09 - naturalHeight * contain / 2) + centerOffsetY;
      text.userData.requestedFontSize = fontSize;
      Object.assign(text.userData, {effectiveFontSize: fontSize * contain, fontWidthScale: widthScale, uniformContainScale: contain, effectiveEmWidth: fontSize * widthScale * contain, physicalWidth: textWidth, physicalHeight: textHeight, inkPadding: raster.inkPadding, glyphCenterCompensation: [centerOffsetX, centerOffsetY]});
      Object.assign(text.userData, {width: textWidth, height: textHeight});
      work.userData.textDimensions = {...text.userData};
      if (text.userData.effectiveFontSize < fontSize * .99) stats.textScales.push({id: record.id, requested: fontSize, effective: text.userData.effectiveFontSize});
      stats.texts++;
    } else if (record.type === 'video') {
      const caseMaterial = new THREE.MeshStandardMaterial({color: record.frameColor || '#20231f', roughness: .47, side: THREE.DoubleSide});
      box(work, '影像显示器_外形示意', width, height, depth, 0, 0, depth / 2, caseMaterial);
      // This is the catalog's supplied still, never a public copy of the video.
      imageOn(work, item, record, Math.min(imageWidth, width - .012), Math.min(imageHeight, height - .012), depth + .001);
      stats.videos++;
    } else if (record.type === 'glass') {
      const glassMaterial = new THREE.MeshStandardMaterial({color: '#dfe8df', transparent: true, opacity: .2, roughness: .2, side: THREE.DoubleSide, depthWrite: false});
      box(work, '墙前玻璃板_试排示意', width, height, .01, 0, 0, .005, glassMaterial);
      imageOn(work, item, record, Math.min(width, imageWidth), Math.min(height, imageHeight), .011, {opacity: .85});
      stats.glass++;
    } else {
      const face = Math.max(0, Math.min(finite(record.frameFace, record.type === 'large' ? 0 : .016), width * .2, height * .2));
      const mat = new THREE.MeshBasicMaterial({color: record.matColor || '#f8f7f2', side: THREE.DoubleSide, toneMapped: false});
      box(work, '背板_试排厚度', width, height, depth * .72, 0, 0, depth * .36, backing);
      plane(work, '白卡纸', Math.max(.001, width - face * 2), Math.max(.001, height - face * 2), mat, depth * .76);
      if (face > 0) {
        const frameMaterial = new THREE.MeshStandardMaterial({color: record.frameColor || '#48483e', roughness: .66, side: THREE.DoubleSide});
        box(work, '上框条', width, face, depth, 0, (height - face) / 2, depth / 2, frameMaterial);
        box(work, '下框条', width, face, depth, 0, -(height - face) / 2, depth / 2, frameMaterial);
        box(work, '左框条', face, height - face * 2, depth, -(width - face) / 2, 0, depth / 2, frameMaterial);
        box(work, '右框条', face, height - face * 2, depth, (width - face) / 2, 0, depth / 2, frameMaterial);
      }
      const slotWidth = Math.min(imageWidth, Math.max(.001, width - face * 2));
      const slotHeight = Math.min(imageHeight, Math.max(.001, height - face * 2));
      imageOn(work, item, record, slotWidth, slotHeight, depth * .76 + .001);
      if (record.type === 'large') stats.large++;
      else stats.photos++;
    }
    if (record.type !== 'text' && record.label !== false) labelForWork(work, item?.title || record.catalogId || record.id, width, height, depth, stats);
    register(record, work, item, center, normal, [width, height]);
  }

  const supportMaterial = new THREE.MeshStandardMaterial({color: '#777b70', metalness: .4, roughness: .48, side: THREE.DoubleSide});
  const glassMaterial = new THREE.MeshStandardMaterial({color: '#dfebe6', transparent: true, opacity: .17, roughness: .18, side: THREE.DoubleSide, depthWrite: false});
  for (const record of layout.freestandingGlass || []) {
    const item = items.get(record.catalogId);
    // yaw is a plan angle: pane width runs from +X towards +canonical Z.
    const angle = finite(record.yaw, 0) * RAD;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    // An optional normal selects the printed/front side without changing yaw.
    if (record.normal && normal[0] * record.normal[0] + normal[1] * record.normal[1] < 0) {
      normal[0] *= -1;
      normal[1] *= -1;
    }
    const width = positive(record.width, .7);
    const height = positive(record.height, 1.2);
    const bottom = Math.max(0, finite(record.bottom, .25));
    const center = [finite(record.x, 0), bottom + height / 2, finite(record.z, 0)];
    const workRecord = {...record, type: 'glass'};
    const work = faceGroup(group, `玻璃板_${record.id}_支撑仅为试排示意`, center, normal);
    box(work, '玻璃基板_厚度待核', width, height, .01, 0, 0, 0, glassMaterial);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, .01)), new THREE.LineBasicMaterial({color: '#819087', transparent: true, opacity: .78}));
    edges.name = '玻璃边缘';
    work.add(edges);
    imageOn(work, item, workRecord, width, height, .006, {opacity: .85});
    let supportDepth = .28, supportWidth = width;
    if (record.supportType === 'tile-display-clamp') {
      const placement = record.supportPlacement || (/trial0[1-4]/.test(String(layout.revision || '')) ? 'inset' : 'edge');
      const descriptor = tileClampGeometry({...record, supportPlacement: placement}, width, height, bottom);
      const materials = {
        metal: new THREE.MeshStandardMaterial({color: '#181a19', roughness: .68, metalness: .2, flatShading: true, side: THREE.DoubleSide}),
        screw: new THREE.MeshStandardMaterial({color: '#464944', roughness: .52, metalness: .5, side: THREE.DoubleSide}),
        rubber: new THREE.MeshStandardMaterial({color: '#121310', roughness: .98, side: THREE.DoubleSide}),
      };
      for (const part of descriptor.parts) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices, 3));
        geometry.setIndex(part.indices); geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, materials[part.kind]);
        mesh.name = `瓷砖夹架_${part.kind}_尺寸示意`; mesh.userData.supportType = record.supportType;
        work.add(mesh);
      }
      const {parts: _parts, ...summary} = descriptor;
      work.userData.supportSummary = summary; supportDepth = descriptor.depth; supportWidth = descriptor.footprintWidth;
      stats.tileClampRacks += descriptor.count; stats.clampPads += descriptor.clampPadCount;
    } else for (const side of [-1, 1]) {
      const x = side * width * .31, baseWidth = Math.min(.13, width * .23);
      box(work, '试排底脚_非施工构造', baseWidth, .035, .28, x, .0175 - center[1], 0, supportMaterial);
      if (bottom > .03) box(work, '试排短支撑_尺寸待核', .026, bottom + .04, .035, x, (bottom + .04) / 2 - center[1], 0, supportMaterial);
    }
    labelForWork(work, item?.title || record.catalogId || record.id, width, height, .01, stats);
    const a = [center[0] - direction[0] * supportWidth / 2, center[2] - direction[1] * supportWidth / 2];
    const b = [center[0] + direction[0] * supportWidth / 2, center[2] + direction[1] * supportWidth / 2];
    // Include the illustrative feet in the walking collision envelope.
    collisionRects.push(segmentRect(record.id, 'glass', a, b, supportDepth));
    register(workRecord, work, item, center, normal, [width, height]);
    stats.glass++;
  }

  for (const record of layout.textScreens || []) {
    const angle = finite(record.yaw, 90) * RAD, direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    if (record.normal && normal[0] * record.normal[0] + normal[1] * record.normal[1] < 0) {
      normal[0] *= -1; normal[1] *= -1;
    }
    const width = positive(record.width, 2.1), height = positive(record.height, 2.2), bottom = Math.max(0, finite(record.bottom, .18));
    const baseWidth = positive(record.baseWidth, width + .1), baseDepth = positive(record.baseDepth, .55), baseHeight = positive(record.baseHeight, .18);
    const face = THREE.MathUtils.clamp(finite(record.frameFace, .02), .003, Math.min(width, height) * .15), depth = positive(record.depth, .026);
    const center = [finite(record.x, .45), bottom + height / 2, finite(record.z, 14.7)];
    const screen = faceGroup(group, `透明文字屏_${record.id}_固定待核定`, center, normal);
    screen.userData = {textScreenId: record.id, type: 'textScreen', notArtwork: true, layout: record, canonicalPosition: center, canonicalNormal: normal};
    const frame = new THREE.MeshStandardMaterial({color: record.frameColor || '#61675f', roughness: .72, metalness: .15, side: THREE.DoubleSide});
    const base = record.baseColor ? new THREE.MeshStandardMaterial({color: record.baseColor, roughness: .85, side: THREE.DoubleSide}) : frame;
    const clear = new THREE.MeshStandardMaterial({color: record.glassColor || '#dce5df', roughness: .16, transparent: true, opacity: finite(record.opacity, .09), depthWrite: false, side: THREE.DoubleSide});
    box(screen, '文字屏透明面_材质厚度待核', width - face * 2, height - face * 2, .008, 0, 0, 0, clear);
    box(screen, '文字屏上框', width, face, depth, 0, (height - face) / 2, 0, frame);
    box(screen, '文字屏下框', width, face, depth, 0, -(height - face) / 2, 0, frame);
    for (const side of [-1, 1]) box(screen, '文字屏竖框', face, height - face * 2, depth, side * (width - face) / 2, 0, 0, frame);
    box(screen, '文字屏连续底座_非施工构造', baseWidth, baseHeight, baseDepth, 0, baseHeight / 2 - center[1], 0, base);
    for (const marking of record.manifestation || []) {
      const bandHeight = positive(marking.bandHeight, .035), lineHeight = positive(marking.lineHeight, .004);
      const y = finite(marking.height, .95) - center[1];
      const band = new THREE.MeshBasicMaterial({color: marking.bandColor || '#f1f1e7', side: THREE.DoubleSide, toneMapped: false});
      const line = new THREE.MeshBasicMaterial({color: marking.lineColor || '#4f5651', side: THREE.DoubleSide, toneMapped: false});
      const markingWidth = Math.min(width - face * 2, positive(marking.width, width - face * 2));
      const fragments = marking.placement === 'edges'
        ? [-1, 1].map(edge => ({x: edge * (width / 2 - face - markingWidth / 2), width: markingWidth}))
        : [{x: 0, width: width - face * 2}];
      for (const side of [-1, 1]) for (const fragment of fragments) {
        const strip = plane(screen, '文字屏乳白显识短段_设计试验', fragment.width, bandHeight, band, side * .006);
        strip.position.set(fragment.x, y, side * .006);
        const keyline = plane(screen, '文字屏深灰细线_双背景对比', fragment.width, lineHeight, line, side * .0065);
        keyline.position.set(fragment.x, y + bandHeight / 2 + lineHeight / 2 + .001, side * .0065);
      }
    }
    textScreens.set(record.id, screen);
    const a = [center[0] - direction[0] * baseWidth / 2, center[2] - direction[1] * baseWidth / 2];
    const b = [center[0] + direction[0] * baseWidth / 2, center[2] + direction[1] * baseWidth / 2];
    collisionRects.push(segmentRect(record.id, 'textScreen', a, b, baseDepth));
    focus.set(record.id, {position: center, normal, dimensions: [width, height]});
    stats.textScreens++;
  }

  for (const record of layout.botanicalGroups || []) {
    const descriptor = botanicalGeometry(record), cluster = new THREE.Group();
    cluster.name = `枯玉米秸秆_${record.id}_体量试排`;
    cluster.position.set(finite(record.x, 0), Math.max(0, finite(record.bottom, 0)), finite(record.z, 0));
    cluster.userData = {botanicalGroupId: record.id, notArtwork: true, layout: record, stalkCount: descriptor.stalkCount, earCount: descriptor.earCount};
    const colors = {stem: record.color || '#9b8968', joint: record.jointColor || '#75664d', leaf: record.leafColor || '#9a8b6a', ear: record.earColor || '#b19a70'};
    for (const part of descriptor.parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices, 3));
      geometry.setIndex(part.indices); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: colors[part.kind], roughness: .94, side: THREE.DoubleSide}));
      mesh.name = {stem: '玉米秸秆茎', joint: '明显茎节', leaf: '扭曲下垂宽叶', ear: '少量带苞穗'}[part.kind];
      mesh.userData = {botanicalGroupId: record.id, botanicalPart: part.kind, notArtwork: true};
      cluster.add(mesh);
    }
    group.add(cluster); botanicalGroups.set(record.id, cluster);
    if (record.collidable) collisionRects.push({id: record.id, type: 'botanical', minX: cluster.position.x - descriptor.width / 2, maxX: cluster.position.x + descriptor.width / 2, minZ: cluster.position.z - descriptor.width / 2, maxZ: cluster.position.z + descriptor.width / 2});
    stats.botanicalGroups++; stats.stalks += descriptor.stalkCount; stats.leaves += descriptor.leafCount; stats.ears += descriptor.earCount;
  }

  for (const record of layout.poems || []) {
    const runs = textRuns(record), actualText = runs.map(run => run.text || '').join('');
    if (!actualText.trim()) continue;
    const fontSize = positive(record.fontSize, .06);
    const suppliedRaster = record.raster && (record.raster.imageUrl || record.raster.url) ? record.raster : poetryRasters.get(record.id) || null;
    const widthScale = THREE.MathUtils.clamp(finite(suppliedRaster?.fontWidthScale, finite(record.fontWidthScale, 1)), .001, 1);
    let width, height, contain = 1, centerOffsetX = 0, centerOffsetY = 0, inkPadding = null, material;
    if (suppliedRaster) {
      // Shared authored-text PNGs carry their native metre dimensions. Their
      // glyph shape, alpha and X/Y compensation are identical to native; never
      // fit or stretch these planes to record.width or reapply fontWidthScale.
      width = positive(suppliedRaster.width ?? suppliedRaster.physicalWidth, .1);
      height = positive(suppliedRaster.height ?? suppliedRaster.physicalHeight, .1);
      centerOffsetX = finite(suppliedRaster.offsetX ?? suppliedRaster.localCenterX, 0);
      centerOffsetY = finite(suppliedRaster.offsetY ?? suppliedRaster.localCenterY, 0);
      contain = finite(suppliedRaster.uniformContainScale, 1);
      stats.poemRasters++;
    } else {
      const raster = textCanvas(actualText, {fontPixels: 96, color: record.color || '#666b58', padding: 5, lineHeight: finite(record.fontLineHeight, finite(record.lineHeight, 1.45)), runs, fontFamily: textFamily(record), weight: record.weight || 300, align: record.align || 'left', trackingPixels: finite(record.letterSpacing, 0) / fontSize * 96});
      const naturalWidth = raster.logicalWidth / raster.fontPixels * fontSize * widthScale;
      contain = Math.min(naturalWidth, positive(record.width, naturalWidth)) / naturalWidth;
      width = raster.rawWidth / raster.fontPixels * fontSize * widthScale * contain;
      height = raster.rawHeight / raster.fontPixels * fontSize * contain;
      centerOffsetX = raster.centerOffsetX / raster.fontPixels * fontSize * widthScale * contain;
      centerOffsetY = raster.centerOffsetY / raster.fontPixels * fontSize * contain;
      inkPadding = raster.inkPadding;
      material = new THREE.MeshBasicMaterial({
        map: canvasTexture(raster.canvas), transparent: true, side: THREE.DoubleSide,
        toneMapped: false, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      if (record.fontFamily === 'huiwen') stats.warnings.push(`诗句 ${record.id} 缺少共享栅格文字图`);
    }
    const angle = finite(record.rotationY, 0) * RAD;
    const position = [finite(record.position?.[0], 0), finite(record.position?.[1], record.surface === 'floor' ? .006 : 1.5), finite(record.position?.[2], 0)];
    let textGroup;
    if (record.surface === 'floor') {
      textGroup = new THREE.Group();
      // At rotationY = 0, text top points towards B and is readable from A.
      // Positive rotation follows a conventional Three.js rotation about Y.
      const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const top = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      textGroup.matrix.makeBasis(right, top, UP);
      position[1] = Math.max(.004, position[1]);
      textGroup.matrix.setPosition(...position);
      textGroup.matrixAutoUpdate = false;
      group.add(textGroup);
    } else {
      // Wall rotationY = 0 faces +canonical Z; +90 faces +canonical X.
      textGroup = faceGroup(group, record.id, position, [Math.sin(angle), Math.cos(angle)]);
    }
    textGroup.name = `诗句_${record.id}`;
    textGroup.userData = {poemId: record.id, text: actualText, layout: record,
      kind: record.surface === 'wall' ? 'wallPoem' : 'floorPoem', canonicalPosition: position,
      textScreenId: record.textScreenId || null,
      canonicalNormal: record.surface === 'wall' ? [Math.sin(angle), Math.cos(angle)] : null,
      requestedFontSize: fontSize, effectiveFontSize: fontSize * contain, fontWidthScale: widthScale, uniformContainScale: contain, effectiveEmWidth: fontSize * widthScale * contain, physicalWidth: width, physicalHeight: height, width, height, inkPadding, glyphCenterCompensation: [centerOffsetX, centerOffsetY], raster: suppliedRaster, preRasterized: Boolean(suppliedRaster)};
    if (contain < .99) stats.textScales.push({id: record.id, requested: fontSize, effective: textGroup.userData.effectiveFontSize});
    const text = suppliedRaster
      ? imageOn(textGroup, null, {...record, imageUrl: suppliedRaster.imageUrl || suppliedRaster.url, type: 'poetry-raster'}, width, height, record.surface === 'floor' ? 0 : .003, {alpha: true, preserveDimensions: true, maxTextureSide: poetryTextureCap})
      : plane(textGroup, '诗句_保留原文换行', width, height, material, record.surface === 'floor' ? 0 : .003);
    text.name = suppliedRaster ? '诗句_共享原生PNG_透明底' : text.name;
    text.material.polygonOffset = true; text.material.polygonOffsetFactor = -2; text.material.polygonOffsetUnits = -2;
    text.position.x = centerOffsetX; text.position.y = centerOffsetY;
    poemGroups.set(record.id, textGroup);
    stats.poems++;
  }

  const ready = Promise.allSettled(pending).then(() => {
    stats.ready = true;
    loadingTexture.dispose();
    return stats;
  });
  group.updateMatrixWorld(true);
  return {
    group, surfaces, works, environmentFields, poemGroups, botanicalGroups, textScreens, collisionRects, ready, stats,
    setVisible(visible) { group.visible = Boolean(visible); },
    focusTarget(id) {
      const record = focus.get(id) || [...focus.entries()].find(([key]) => works.get(key)?.userData.catalogId === id)?.[1];
      if (!record) return null;
      const distance = THREE.MathUtils.clamp(Math.max(...record.dimensions) * .9 + .55, 1.15, 2.7);
      const [x, y, z] = record.position;
      const [nx, nz] = record.normal;
      return {position: [x + nx * distance, 1.6, z + nz * distance], target: [x, y, z], normal: [nx, nz], distance, coordinateSpace: 'canonical'};
    },
  };
}
