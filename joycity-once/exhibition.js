import * as THREE from 'three';

// All input and focus coordinates use the surveyed model's canonical system:
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

function textCanvas(text, {fontPixels = 72, color = '#575951', padding = 12, lineHeight = 1.4, runs, fontFamily = 'serif'} = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const family = fontFamily === 'sans' ? '"PingFang SC", system-ui, sans-serif' : '"Songti SC", "Noto Serif CJK SC", "STSong", serif';
  const fontFor = run => `${run.weight || 300} ${fontPixels * positive(run.fontScale, 1)}px ${family}`;
  const lines = [[]];
  for (const run of runs?.length ? runs : [{text: String(text)}]) {
    String(run.text || '').replace(/\r\n?/g, '\n').split('\n').forEach((part, index) => {
      if (index) lines.push([]);
      const segment = {...run, text: part};
      context.font = fontFor(segment);
      segment.width = context.measureText(part).width;
      lines[lines.length - 1].push(segment);
    });
  }
  const lineWidths = lines.map(segments => segments.reduce((width, run) => width + run.width, 0));
  const lineScales = lines.map(segments => Math.max(1, ...segments.map(run => positive(run.fontScale, 1))));
  const measured = Math.max(1, ...lineWidths);
  // Keep the supplied line breaks. A uniform raster scale limits texture size;
  // it does not change the text or its physical aspect ratio.
  const rawWidth = measured + padding * 2;
  const rawHeight = lineScales.reduce((height, scale) => height + fontPixels * lineHeight * scale, 0) + padding * 2;
  const rasterScale = Math.min(1, 4096 / rawWidth, 4096 / rawHeight);
  canvas.width = Math.max(2, Math.ceil(rawWidth * rasterScale));
  canvas.height = Math.max(2, Math.ceil(rawHeight * rasterScale));
  context.scale(rasterScale, rasterScale);
  context.fillStyle = color;
  context.textBaseline = 'alphabetic';
  let y = padding;
  lines.forEach((segments, index) => {
    let x = padding;
    const baseline = y + fontPixels * lineScales[index];
    for (const run of segments) {
      context.font = fontFor(run);
      context.fillText(run.text, x, baseline);
      x += run.width;
    }
    y += fontPixels * lineHeight * lineScales[index];
  });
  return {canvas, rawWidth, rawHeight, fontPixels};
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

/**
 * Builds geometry immediately. Await the returned ready promise only when all
 * image previews must have finished loading; navigation can start beforehand.
 * works Map values are THREE.Group objects; surfaces Map values are normalized
 * canonical descriptors. focusTarget() always returns canonical coordinates.
 */
export async function buildExhibition({scene, renderer, layout = {}, catalog = {}}) {
  const group = new THREE.Group();
  group.name = '首轮策展试排_全部尺寸以布展复核为准';
  group.scale.z = -1;
  group.userData = {revision: layout.revision, status: layout.status, coordinateSpace: 'canonical', trial: true};
  scene?.add(group);

  const surfaces = new Map();
  const works = new Map();
  const environmentFields = new Map();
  const poemGroups = new Map();
  const collisionRects = [];
  const focus = new Map();
  const pending = [];
  const stats = {
    works: 0, workCount: 0, photos: 0, large: 0, videos: 0, glass: 0, texts: 0,
    partitions: 0, surfaces: 0, poems: 0, labels: 0, wallFields: 0, floorFields: 0,
    textures: 0, loaded: 0, errors: 0, pending: 0, texturePixels: 0, textureResamples: 0,
    failures: [], warnings: [], aspectAdjustments: [], ready: false,
  };
  const items = catalog instanceof Map ? catalog : new Map((Array.isArray(catalog) ? catalog : catalog.items || []).map(item => [item.id, item]));
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 1, 8);
  const loadingTexture = messageTexture('图像载入中');
  let errorTexture;
  const white = new THREE.MeshStandardMaterial({color: '#f2f1ec', roughness: .86, side: THREE.DoubleSide});
  const backing = new THREE.MeshStandardMaterial({color: '#e5e3dc', roughness: .9, side: THREE.DoubleSide});

  function register(record, object, item, position, normal, dimensions) {
    works.set(record.id, object);
    markWork(object, record, item);
    object.userData.canonicalPosition = [...position];
    object.userData.canonicalNormal = [...normal];
    focus.set(record.id, {position, normal, dimensions});
    stats.works++;
    stats.workCount = stats.works;
  }

  function imageOn(object, item, record, width, height, z, {opacity = 1} = {}) {
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff', map: loadingTexture, side: THREE.DoubleSide,
      toneMapped: false, transparent: opacity < 1, opacity,
      depthWrite: opacity === 1,
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
        const maxTextureSide = record.type === 'photo' ? 1024 : 2048;
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
        const renderedWidth = Math.min(width, height * ratio);
        const renderedHeight = renderedWidth / ratio;
        image.scale.set(renderedWidth / width, renderedHeight / height, 1);
        image.userData.nativePixels = [nativeWidth, nativeHeight];
        image.userData.renderedDimensions = [renderedWidth, renderedHeight];
        if (Math.abs(width / height / ratio - 1) > .012) {
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
      const raster = textCanvas(record.text || '', {fontPixels: 96, padding: 5, color: record.color || '#42473e', runs: record.runs, lineHeight: finite(record.lineHeight, 1.6), fontFamily: record.fontFamily});
      const fontSize = positive(record.fontSize, .045);
      const textWidth = Math.min(Math.max(.001, width - .12), raster.rawWidth / raster.fontPixels * fontSize,
        record.align === 'center' ? Math.max(.001, height - .04) * raster.rawWidth / raster.rawHeight : Infinity);
      const textHeight = textWidth * raster.rawHeight / raster.rawWidth;
      const material = new THREE.MeshBasicMaterial({map: canvasTexture(raster.canvas), transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false});
      const text = plane(work, '前言原文_不增写内容', textWidth, textHeight, material, .009);
      text.position.x = record.align === 'center' ? 0 : -width / 2 + .06 + textWidth / 2;
      text.position.y = record.align === 'center' ? 0 : height / 2 - .09 - textHeight / 2;
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
    for (const side of [-1, 1]) {
      const x = side * width * .31;
      const baseWidth = Math.min(.13, width * .23);
      box(work, '试排底脚_非施工构造', baseWidth, .035, .28, x, .0175 - center[1], 0, supportMaterial);
      if (bottom > .03) box(work, '试排短支撑_尺寸待核', .026, bottom + .04, .035, x, (bottom + .04) / 2 - center[1], 0, supportMaterial);
    }
    labelForWork(work, item?.title || record.catalogId || record.id, width, height, .01, stats);
    const a = [center[0] - direction[0] * width / 2, center[2] - direction[1] * width / 2];
    const b = [center[0] + direction[0] * width / 2, center[2] + direction[1] * width / 2];
    // Include the illustrative feet in the walking collision envelope.
    collisionRects.push(segmentRect(record.id, 'glass', a, b, .28));
    register(workRecord, work, item, center, normal, [width, height]);
    stats.glass++;
  }

  for (const record of layout.poems || []) {
    const actualText = record.runs?.length ? record.runs.map(run => run.text || '').join('') : String(record.text || '');
    if (!actualText.trim()) continue;
    const raster = textCanvas(actualText, {fontPixels: 96, color: record.color || '#666b58', padding: 5, lineHeight: finite(record.lineHeight, 1.45), runs: record.runs});
    const fontSize = positive(record.fontSize, .06);
    const naturalWidth = raster.rawWidth / raster.fontPixels * fontSize;
    const width = Math.min(naturalWidth, positive(record.width, naturalWidth));
    const height = width * raster.rawHeight / raster.rawWidth;
    const material = new THREE.MeshBasicMaterial({
      map: canvasTexture(raster.canvas), transparent: true, side: THREE.DoubleSide,
      toneMapped: false, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
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
      canonicalNormal: record.surface === 'wall' ? [Math.sin(angle), Math.cos(angle)] : null};
    plane(textGroup, '诗句_保留原文换行', width, height, material, record.surface === 'floor' ? 0 : .003);
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
    group, surfaces, works, environmentFields, poemGroups, collisionRects, ready, stats,
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
