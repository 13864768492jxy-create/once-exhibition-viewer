// The editor only transforms authored poem groups. It never rewrites glyphs,
// baseline layout records, image pixels, carrier glass or photography.
const EPS = 1e-8;
const IDENTITY = Object.freeze({u: 0, v: 0, scale: 1});
// These released layouts share every poem's coordinate system and support dimensions.
const TRIAL20 = {revision: '20261118-trial20', sha: '04e5ead6ffd317af3851230e24312e7f4af5b149f4d0f6eca13fed8d80f0070b'};
const TRIAL21 = {revision: '20261118-trial21', sha: 'ce7cad5654edf970e98ad0b5b642efd481e92e11cf3701c7384bad4d8b9ba247'};
// Newest first. These exact releases share all 19 authored poem planes and support dimensions.
const TRIAL22_EDITIONS = [
  '18ec324d7d007ff7a201242d345bb3adb74df34dd36012203282e84472886e00',
  'e90a6d26372d33f4894b2b11c295846f693f5f9167912743ae0f041b1f92f4d4',
  'dbb4144adca7abedd904fcb8ac1bbe5b99053891b8e09d58259c329d0d10d627',
  '22292638cdb5b29a09b0c20f4b9bb15783fda22ab3c63446151c3c0f0076ba9d',
  '6e17a65df9a5dad7acd2cfd7c64db7bf70e35490d5931b49d876147862e472d4',
  '5138830b57c0e9da3da86044cef09da78e84616d074bcc4a67a6c5f82a0bf6dc',
  '0c964905696d87ec632aff2f7eaf0c5c96606ffe03196e9aaf587ac355a5233a',
  '60ca842cd35313d089854b5107c27f9a99d26e15539fe11a6dc10661ad230a3e',
];
const DEFAULT_LOCKS = new Set(['across', 'across-gen']);
const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a, b) => Math.abs(a.u - b.u) < EPS && Math.abs(a.v - b.v) < EPS && Math.abs(a.scale - b.scale) < EPS;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function polygonArea(points) {
  return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0) / 2;
}
function clip(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= EPS) out.push(p);
    if ((dp < -EPS && dq > EPS) || (dp > EPS && dq < -EPS)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
function nearestPoint(poly, p) {
  if (poly.length < 1) throw new Error('当前字块放不进这个平面，请减小尺寸。');
  let inside = true, best = null, bestDistance = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx * (p[1] - a[1]) - dy * (p[0] - a[0]) < -EPS) inside = false;
    const len2 = dx * dx + dy * dy;
    const t = len2 > EPS ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t];
    const distance = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = q; }
  }
  return inside && poly.length >= 3 ? p : best;
}

export function createPoetryEditorModel({THREE, exhibition, layout, space, onChange = () => {}, baseLayoutSHA256}) {
  if (!exhibition?.group || !exhibition?.poemGroups || !layout?.revision || !space?.room) throw new Error('文字编辑器缺少展厅数据。');
  const sourceSHA = baseLayoutSHA256 || exhibition.group.userData.poetryRasterManifest?.sourceLayoutSHA256;
  if (typeof sourceSHA !== 'string' || !/^[a-f0-9]{64}$/i.test(sourceSHA)) throw new Error('文字编辑器缺少已核验的基准版本。');
  const acceptsTrial20 = layout.revision === TRIAL21.revision && sourceSHA === TRIAL21.sha;
  const migration22 = layout.revision === '20261119-trial22' && layout.curationRevision?.sourceLayoutSHA256 === TRIAL21.sha
    ? layout.curationRevision.draftMigration : null;
  const ancestors = migration22 ? [TRIAL21,TRIAL20] : acceptsTrial20 ? [TRIAL20] : [];
  const editionIndex = migration22 ? TRIAL22_EDITIONS.indexOf(sourceSHA) : -1;
  const previousEditions = editionIndex < 0 ? [] : TRIAL22_EDITIONS.slice(editionIndex + 1);
  const savedHashes = [sourceSHA, ...previousEditions, ...ancestors.map(base => base.sha)];
  const entries = new Map(), values = new Map(), undoStack = [], redoStack = [];
  let transaction = null, disposed = false;
  exhibition.group.updateWorldMatrix(true, true);
  const rootInverse = exhibition.group.matrixWorld.clone().invert();

  function rectangleOnPlane(center, right, width, bottom, height) {
    return [[-width / 2, bottom], [width / 2, bottom], [width / 2, bottom + height], [-width / 2, bottom + height]].map(([x, y]) => [center[0] + right[0] * x, y, center[1] + right[1] * x]);
  }
  function supportFor(record, canonicalMatrix) {
    const position = record.position, normal = new THREE.Vector3(0, 0, 1).transformDirection(canonicalMatrix);
    if (record.textScreenId || record.glassPanelId) {
      const isScreen = Boolean(record.textScreenId);
      const descriptor = (isScreen ? layout.textScreens : layout.poetryGlassPanels)?.find(p => p.id === (record.textScreenId || record.glassPanelId));
      if (!descriptor) throw new Error(`找不到「${record.id}」的玻璃平面。`);
      const angle = (descriptor.yaw || 0) * Math.PI / 180;
      const margin = isScreen ? (descriptor.frameFace || .01) : .002;
      return {id: descriptor.id, kind: 'glass', label: isScreen ? '前段独立玻璃' : 'Growing Again 诗歌玻璃', canonicalPolygon: rectangleOnPlane([descriptor.x, descriptor.z], [Math.cos(angle), Math.sin(angle)], descriptor.width - margin * 2, descriptor.bottom + margin, descriptor.height - margin * 2)};
    }
    if (record.surface === 'floor') {
      const W = space.room.width, L = space.room.length;
      const left = space.leftWallTurn?.points || [[0, 0], [0, L]];
      const a = space.ends?.A?.slope;
      const rightStart = a ? a.rightZ : 0;
      const points = [left[0], [W, rightStart], [W, L], [0, L], ...left.slice(1, -1).reverse()];
      return {id: 'floor', kind: 'floor', label: '地面', canonicalPolygon: points.map(([x, z]) => [x, position[1], z])};
    }
    let best = null, distance = Infinity;
    for (const surface of layout.surfaces || []) {
      const [nx, nz] = surface.normal || [0, 0];
      if (normal.x * nx + normal.z * nz < .97) continue;
      const dx = surface.b[0] - surface.a[0], dz = surface.b[1] - surface.a[1], length = Math.hypot(dx, dz);
      const along = ((position[0] - surface.a[0]) * dx + (position[2] - surface.a[1]) * dz) / length;
      const dist = Math.abs((position[0] - surface.a[0]) * nx + (position[2] - surface.a[1]) * nz);
      if (dist < distance && along >= -.1 && along <= length + .1) { best = surface; distance = dist; }
    }
    if (!best || distance > .12) throw new Error(`无法确认「${record.id}」所在墙面。`);
    let a = best.a, b = best.b;
    if (best.id === 'once-main' && space.leftWallTurn?.points?.length > 2) a = space.leftWallTurn.points.at(-2);
    const label = best.id === 'once-main' ? '左侧长墙' : best.id === 'other-main' ? '右侧长墙' : best.kind === 'partition' ? '活动板墙' : '墙面';
    return {id: best.id, kind: 'wall', label, canonicalPolygon: [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], best.height, b[1]], [a[0], best.height, a[1]]]};
  }

  for (const record of layout.poems || []) {
    const object = exhibition.poemGroups.get(record.id);
    if (!object) continue;
    const data = object.userData, baseMatrix = object.matrix.clone();
    const baseCanonicalMatrix = rootInverse.clone().multiply(object.matrixWorld);
    const sourceWidth = Number(data.physicalWidth || data.width), sourceHeight = Number(data.physicalHeight || data.height);
    if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error(`「${record.id}」的文字尺寸无效。`);
    const f = record.framedPaper;
    const width = f ? f.paperWidth + 2 * f.paperGap + 2 * f.frameFace : sourceWidth;
    const height = f ? f.paperHeight + 2 * f.paperGap + 2 * f.frameFace : sourceHeight;
    const [offsetX, offsetY] = f ? [0, 0] : data.glyphCenterCompensation || [0, 0];
    const support = supportFor(record, baseCanonicalMatrix), inverse = baseCanonicalMatrix.clone().invert();
    let polygon = support.canonicalPolygon.map(p => { const q = new THREE.Vector3(...p).applyMatrix4(inverse); return [q.x, q.y]; });
    if (polygonArea(polygon) < 0) polygon.reverse();
    const halfplanes = polygon.map((p, i) => { const q = polygon[(i + 1) % polygon.length], a = q[1] - p[1], b = p[0] - q[0]; return [a, b, a * p[0] + b * p[1]]; });
    const entry = {record, object, baseMatrix, basePosition: [...record.position], baseCanonicalMatrix, width, height, sourceWidth, sourceHeight, offsetX, offsetY, locked: DEFAULT_LOCKS.has(record.id), scaleLocked: Boolean(f), surfaceLabel: support.label, support, halfplanes, polygon, originalAutoUpdate: object.matrixAutoUpdate};
    entries.set(record.id, entry); values.set(record.id, {...IDENTITY});
    object.matrixAutoUpdate = false;
  }

  function entryFor(id) { const e = entries.get(id); if (!e) throw new Error(`找不到文字块：${id}`); return e; }
  function feasible(entry, scale) {
    let poly = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
    for (const [a, b, c] of entry.halfplanes) {
      const extent = a * entry.offsetX + b * entry.offsetY + Math.abs(a) * entry.width / 2 + Math.abs(b) * entry.height / 2;
      poly = clip(poly, a, b, c - scale * extent);
      if (!poly.length) break;
    }
    return poly;
  }
  function maximumScale(entry) {
    if (entry.scaleLocked) return 1;
    if (feasible(entry, 2).length) return 2;
    let lo = .25, hi = 2;
    for (let i = 0; i < 35; i++) { const mid = (lo + hi) / 2; if (feasible(entry, mid).length) lo = mid; else hi = mid; }
    return Math.max(.25, lo - 1e-7);
  }
  for (const entry of entries.values()) {
    entry.maxScale = maximumScale(entry);
    if (!feasible(entry, 1).length) throw new Error(`基准文字块「${entry.record.id}」超过载体尺寸，暂不能编辑。`);
  }
  function apply(id, value) {
    const entry = entryFor(id);
    entry.object.matrix.copy(entry.baseMatrix).multiply(new THREE.Matrix4().makeTranslation(value.u, value.v, 0)).multiply(new THREE.Matrix4().makeScale(value.scale, value.scale, 1));
    entry.object.matrixWorldNeedsUpdate = true;
    entry.object.updateWorldMatrix(true, true);
    values.set(id, {...value});
  }
  function snapshot() { return {transforms: Object.fromEntries([...values].map(([id, v]) => [id, {...v}])), locks: Object.fromEntries([...entries].map(([id, e]) => [id, e.locked]))}; }
  function restore(state) {
    for (const [id, value] of Object.entries(state.transforms)) apply(id, value);
    for (const [id, locked] of Object.entries(state.locks)) entryFor(id).locked = locked;
  }
  function changed(a, b) { return [...entries.keys()].some(id => !same(a.transforms[id], b.transforms[id]) || a.locks[id] !== b.locks[id]); }
  function getStatus() { return {canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, changedCount: [...values.values()].filter(v => !same(v, IDENTITY)).length, inTransaction: Boolean(transaction)}; }
  function notify(reason, id) { if (!disposed) onChange({reason, id, ...getStatus()}); }
  function push(before, after) { if (changed(before, after)) { undoStack.push(before); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; } }
  function validated(entry, raw, strict = false) {
    if (!plain(raw) || Object.keys(raw).some(k => !['u', 'v', 'scale'].includes(k)) || !['u', 'v', 'scale'].every(k => finite(raw[k]))) throw new Error('位置和比例必须是有限数字。');
    const min = entry.scaleLocked ? 1 : .25, max = entry.maxScale;
    const scale = Math.max(min, Math.min(max, raw.scale));
    if (strict && Math.abs(scale - raw.scale) > EPS) throw new Error(`「${entry.record.id}」的比例超出允许范围。`);
    const [u, v] = nearestPoint(feasible(entry, scale), [raw.u, raw.v]);
    if (strict && (Math.abs(u - raw.u) > 1e-6 || Math.abs(v - raw.v) > 1e-6)) throw new Error(`「${entry.record.id}」超出了所在平面。`);
    return {u: Math.abs(u) < EPS ? 0 : u, v: Math.abs(v) < EPS ? 0 : v, scale};
  }
  function begin() { if (!transaction) transaction = snapshot(); }
  function commit() { if (transaction) { const before = transaction; transaction = null; push(before, snapshot()); notify('commit'); } }
  function cancel() { if (transaction) { const before = transaction; transaction = null; restore(before); notify('cancel'); } }
  function change(id, patch, {commit: immediate = true} = {}) {
    const entry = entryFor(id);
    if (entry.locked) return {...values.get(id)};
    if (!plain(patch) || Object.keys(patch).some(k => !['u', 'v', 'scale'].includes(k))) throw new Error('文字变更字段无效。');
    const value = validated(entry, {...values.get(id), ...patch});
    const before = immediate && !transaction ? snapshot() : null;
    if (!same(value, values.get(id))) apply(id, value);
    if (before) push(before, snapshot());
    notify(immediate ? 'change' : 'preview', id);
    return {...value};
  }
  function getBounds(id) {
    const entry = entryFor(id), poly = feasible(entry, values.get(id).scale);
    return {u: {min: Math.min(...poly.map(p => p[0])), max: Math.max(...poly.map(p => p[0]))}, v: {min: Math.min(...poly.map(p => p[1])), max: Math.max(...poly.map(p => p[1]))}, scale: {min: entry.scaleLocked ? 1 : .25, max: entry.maxScale}, polygon: poly, surfaceLabel: entry.surfaceLabel, baseSupport: clone(entry.support)};
  }
  function reset(id) { return change(id, IDENTITY); }
  function resetAll() {
    if (transaction) cancel();
    const before = snapshot();
    for (const id of entries.keys()) { apply(id, IDENTITY); entryFor(id).locked = DEFAULT_LOCKS.has(id); }
    push(before, snapshot()); notify('reset-all');
  }
  function undo() {
    if (transaction) cancel();
    if (!undoStack.length) return false;
    redoStack.push(snapshot()); restore(undoStack.pop()); notify('undo'); return true;
  }
  function redo() {
    if (transaction) cancel();
    if (!redoStack.length) return false;
    undoStack.push(snapshot()); restore(redoStack.pop()); notify('redo'); return true;
  }
  function setLocked(id, locked) {
    if (typeof locked !== 'boolean') throw new Error('锁定状态无效。');
    if (transaction) commit();
    const before = snapshot(); entryFor(id).locked = locked; push(before, snapshot()); notify('lock', id);
  }
  function exportDraft() { return {schema: 'once-poetry-draft', version: 1, baseRevision: layout.revision, baseLayoutSHA256: sourceSHA, units: 'metres', ...snapshot()}; }
  function validateDraft(draft) {
    if (!plain(draft) || draft.schema !== 'once-poetry-draft' || draft.version !== 1) throw new Error('这不是可读取的 ONCE 文字试排方案。');
    const current = draft.baseRevision === layout.revision && draft.baseLayoutSHA256 === sourceSHA;
    const inherited = ancestors.some(base => draft.baseRevision === base.revision && draft.baseLayoutSHA256 === base.sha);
    const previousEdition = draft.baseRevision === layout.revision && previousEditions.includes(draft.baseLayoutSHA256);
    if (!current && !inherited && !previousEdition) throw new Error('方案来自另一版展厅，请打开对应基准版本后再导入。');
    if ((!current || draft.units != null) && draft.units !== 'metres') throw new Error('草稿位移单位须为米。');
    if (!plain(draft.transforms) || (draft.locks != null && !plain(draft.locks))) throw new Error('方案中的文字位置数据无效。');
    if (Object.keys(draft.transforms).some(id => !entries.has(id)) || Object.keys(draft.locks || {}).some(id => !entries.has(id))) throw new Error('方案含有当前展厅不存在的文字块。');
    const next = {transforms: {}, locks: {}};
    for (const [id, entry] of entries) {
      const raw = draft.transforms[id] ?? IDENTITY;
      if (inherited && migration22?.addedIds.includes(id) && (id in draft.transforms || id in (draft.locks || {}))) {
        throw new Error('旧版草稿含有该版本尚未展出的文字。');
      }
      if (inherited && migration22?.resetIds.includes(id)) {
        if (!plain(raw) || Object.keys(raw).length !== 3 || ![raw.u,raw.v,raw.scale].every(finite) || raw.scale < .25 || raw.scale > 2) {
          throw new Error('旧版文字数据无效。');
        }
        next.transforms[id] = {...IDENTITY};
      } else {
        const applied = (!current && id in draft.transforms) && migration22?.wallTranslationsApplied?.[id];
        if (applied && (!plain(raw) || !finite(raw.u) || !finite(raw.v))) {
          throw new Error('旧版文字位置无效。');
        }
        // The published base already contains these translations. Re-express a
        // saved draft in its new origin so its world-space placement is preserved.
        const offset = applied ? {...raw, u: raw.u-applied.u, v: raw.v-applied.v} : raw;
        next.transforms[id] = validated(entry, offset, true);
      }
      const locked = draft.locks?.[id] ?? DEFAULT_LOCKS.has(id);
      if (typeof locked !== 'boolean') throw new Error(`「${id}」的锁定状态无效。`);
      next.locks[id] = locked;
    }
    return next;
  }
  // Offer the newest compatible saved draft without applying it or rewriting storage.
  function findSavedDraft(read) {
    for (const sha of savedHashes) {
      try {
        const draft = JSON.parse(read(sha));
        if (draft?.baseLayoutSHA256 !== sha) continue;
        validateDraft(draft);
        return draft;
      } catch { /* Invalid or inaccessible local data cannot be restored. */ }
    }
    return null;
  }
  function importDraft(input) {
    const draft = typeof input === 'string' ? JSON.parse(input) : input;
    const next = validateDraft(draft);
    // Validate the whole document before touching either visible state or undo.
    if (transaction) cancel();
    const before = snapshot(); restore(next); push(before, snapshot()); notify('import');
    return getStatus();
  }
  return {entries, get: id => ({...values.get(entryFor(id).record.id)}), change, begin, commit, cancel, undo, redo, reset, resetAll, exportDraft, importDraft, findSavedDraft, setLocked, getBounds,
    get status() { return getStatus(); },
    dispose() { if (transaction) cancel(); for (const entry of entries.values()) { entry.object.matrix.copy(entry.baseMatrix); entry.object.matrixAutoUpdate = entry.originalAutoUpdate; entry.object.matrixWorldNeedsUpdate = true; entry.object.updateWorldMatrix(true, true); } disposed = true; },
  };
}
