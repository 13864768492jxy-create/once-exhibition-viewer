// Alpha-aware picking keeps the open spaces inside authored poem compositions
// from taking clicks intended for another group. No source image is changed.

/** Pure helper; axisX / axisY map a unit screen-space disk into mask pixels. */
export function alphaWithinEllipse(mask, x, y, axisX, axisY, threshold = 8) {
  const {width, height, data} = mask;
  if (![x, y, ...axisX, ...axisY].every(Number.isFinite) || !width || !height) return false;
  const rx = Math.hypot(axisX[0], axisY[0]), ry = Math.hypot(axisX[1], axisY[1]);
  const minX = Math.max(0, Math.floor(x - rx - 1)), maxX = Math.min(width - 1, Math.ceil(x + rx + 1));
  const minY = Math.max(0, Math.floor(y - ry - 1)), maxY = Math.min(height - 1, Math.ceil(y + ry + 1));
  const det = axisX[0] * axisY[1] - axisX[1] * axisY[0];
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if (data[py * width + px] < threshold) continue;
      const dx = px + .5 - x, dy = py + .5 - y;
      // A source pixel covers an area, not just its centre. This also gives
      // thin strokes reliable direct hits after the mask has been downsampled.
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return true;
      if (Math.abs(det) < 1e-9) continue;
      const u = (dx * axisY[1] - dy * axisY[0]) / det;
      const v = (axisX[0] * dy - axisX[1] * dx) / det;
      if (u * u + v * v <= 1) return true;
    }
  }
  return false;
}

/**
 * The caller first tests the group's rectangle. Return true for visible ink,
 * a framed sheet, or an image not yet readable (temporary rectangle fallback).
 * Successful masks are keyed by the actual texture image; a later-loaded or
 * replaced image is checked afresh. Failed reads retry after two seconds.
 */
export function createPoetryInkPicker({THREE, getCamera, canvas, radius = 5}) {
  const cache = new WeakMap();
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), origin = new THREE.Vector3();
  const plane = new THREE.Plane(), inverse = new THREE.Matrix4();
  const tolerance = Number.isFinite(radius) ? Math.max(4, Math.min(6, radius)) : 5;

  function maskFor(image) {
    if (!image || typeof image !== 'object' || image.complete === false) return null;
    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;
    if (!(width > 0 && height > 0)) return null;
    const key = `${width}x${height}:${image.currentSrc || image.src || ''}`;
    const previous = cache.get(image), now = Date.now();
    if (previous?.key === key && (previous.mask || now < previous.retryAt)) return previous.mask;
    try {
      const factor = Math.min(1, 1024 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * factor)), h = Math.max(1, Math.round(height * factor));
      const offscreen = document.createElement('canvas'); offscreen.width = w; offscreen.height = h;
      const context = offscreen.getContext('2d', {willReadFrequently: true});
      if (!context) throw new Error('No readable image canvas');
      context.drawImage(image, 0, 0, w, h);
      const rgba = context.getImageData(0, 0, w, h).data;
      const alpha = new Uint8Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      const mask = {width: w, height: h, data: alpha};
      cache.set(image, {key, mask});
      return mask;
    } catch {
      cache.set(image, {key, mask: null, retryAt: now + 2000});
      return null;
    }
  }

  return function inkHit(entry, event) {
    if (entry.record?.framedPaper) return true;
    const mesh = entry.object.children.find(child => child.isMesh && child.geometry?.type === 'PlaneGeometry' && child.material?.map);
    if (!mesh || mesh.userData.loadError || (mesh.userData.source && !mesh.userData.nativePixels)) return true;
    const texture = mesh.material.map, mask = maskFor(texture.image);
    if (!mask) return true;
    const width = mesh.geometry.parameters?.width, height = mesh.geometry.parameters?.height;
    const rect = canvas.getBoundingClientRect(), camera = getCamera();
    if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0) || !camera) return true;
    camera.updateMatrixWorld(); mesh.updateWorldMatrix(true, false);
    inverse.copy(mesh.matrixWorld).invert();
    normal.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    origin.setFromMatrixPosition(mesh.matrixWorld); plane.setFromNormalAndCoplanarPoint(normal, origin);
    texture.updateMatrix();
    function imagePoint(clientX, clientY) {
      ndc.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(plane, point);
      if (!hit) return null;
      hit.applyMatrix4(inverse);
      const uv = new THREE.Vector2(hit.x / width + .5, hit.y / height + .5);
      // Keep the UV derivative un-clamped near the image edge, otherwise a
      // five-pixel hit radius collapses to zero on the last letter. These
      // authored image planes do not repeat; mask bounds clip the sampled area.
      uv.applyMatrix3(texture.matrix);
      if (texture.flipY) uv.y = 1 - uv.y;
      return [uv.x * mask.width, uv.y * mask.height];
    }
    const p = imagePoint(event.clientX, event.clientY);
    const px = imagePoint(event.clientX + tolerance, event.clientY);
    const py = imagePoint(event.clientX, event.clientY + tolerance);
    if (!p || !px || !py) return false;
    return alphaWithinEllipse(mask, p[0], p[1], [px[0] - p[0], px[1] - p[1]], [py[0] - p[0], py[1] - p[1]]);
  };
}
