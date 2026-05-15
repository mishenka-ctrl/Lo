import * as THREE from "https://esm.sh/three@0.164.1";

const canvas = document.querySelector("#world");
const overlay = document.querySelector("#overlay");
const hotbar = document.querySelector("#hotbar");
const statusLine = document.querySelector("#status");

const WORLD_SIZE = 22;
const MAX_HEIGHT = 8;
const REACH = 7;
const PLAYER_HEIGHT = 1.75;
const PLAYER_RADIUS = 0.32;
const GRAVITY = 24;
const JUMP_SPEED = 8.1;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 7.4;

const blockTypes = [
  { id: "grass", name: "Grass", color: 0x4fa33d, side: 0x8b633f },
  { id: "dirt", name: "Dirt", color: 0x7d5833 },
  { id: "stone", name: "Stone", color: 0x888c8e },
  { id: "wood", name: "Wood", color: 0x8b5a2b, side: 0x6f421d },
  { id: "glass", name: "Glass", color: 0x8fd8ff, transparent: true },
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83c5ff);
scene.fog = new THREE.Fog(0x83c5ff, 45, 92);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const sun = new THREE.DirectionalLight(0xfff0c4, 2.4);
sun.position.set(18, 34, 14);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x476d3f, 1.55));

const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const pointer = new THREE.Vector2(0, 0);
const tempVector = new THREE.Vector3();
const tempBox = new THREE.Box3();
const playerBox = new THREE.Box3();
const matrix = new THREE.Matrix4();
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const world = new Map();
const blockMeshes = new Map();
const targetMeshes = [];
const keys = new Set();
const velocity = new THREE.Vector3();
const player = {
  position: new THREE.Vector3(0, 16, 0),
  yaw: 0,
  pitch: 0,
  onGround: false,
};

let selectedBlock = 0;
let highlight;
let lastTime = performance.now();

const neighborOffsets = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function unpackKey(key) {
  return key.split(",").map(Number);
}

function isOccupied(x, y, z) {
  return world.has(blockKey(x, y, z));
}

function createMaterial(block) {
  const color = new THREE.Color(block.color);
  return new THREE.MeshLambertMaterial({
    color,
    transparent: block.transparent ?? false,
    opacity: block.transparent ? 0.48 : 1,
  });
}

const materials = blockTypes.map(createMaterial);
const hoverMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
});
const typeMeshes = blockTypes.map((block, index) => {
  const mesh = new THREE.InstancedMesh(blockGeometry, materials[index], WORLD_SIZE * WORLD_SIZE * (MAX_HEIGHT + 6));
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.typeIndex = index;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
});

function terrainHeight(x, z) {
  const rolling = Math.sin(x * 0.38) * 1.8 + Math.cos(z * 0.31) * 1.6;
  const hills = Math.sin((x + z) * 0.18) * 1.2 + Math.cos((x - z) * 0.24);
  return Math.max(2, Math.min(MAX_HEIGHT, Math.round(5 + rolling + hills)));
}

function setBlockRaw(x, y, z, typeIndex = 0) {
  const key = blockKey(x, y, z);
  if (world.has(key)) return;
  world.set(key, typeIndex);
}

function isBlockVisible(x, y, z) {
  return neighborOffsets.some(([offsetX, offsetY, offsetZ]) => !isOccupied(x + offsetX, y + offsetY, z + offsetZ));
}

function rebuildVisibleMeshes() {
  targetMeshes.length = 0;
  blockMeshes.clear();
  typeMeshes.forEach((mesh) => {
    mesh.count = 0;
  });

  for (const [key, typeIndex] of world.entries()) {
    const [x, y, z] = unpackKey(key);
    if (!isBlockVisible(x, y, z)) continue;
    const mesh = typeMeshes[typeIndex];
    matrix.makeTranslation(x, y, z);
    mesh.setMatrixAt(mesh.count, matrix);
    mesh.count += 1;
    blockMeshes.set(key, { x, y, z, typeIndex });
    targetMeshes.push({ x, y, z, typeIndex });
  }

  typeMeshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });
}

function addBlock(x, y, z, typeIndex = 0) {
  const key = blockKey(x, y, z);
  if (world.has(key)) return;
  world.set(key, typeIndex);
  rebuildVisibleMeshes();
}

function removeBlock(key) {
  world.delete(key);
  rebuildVisibleMeshes();
}

function buildWorld() {
  blockMeshes.clear();
  targetMeshes.length = 0;
  world.clear();

  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x += 1) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z += 1) {
      const height = terrainHeight(x, z);
      for (let y = 0; y <= height; y += 1) {
        const type = y === height ? 0 : y > height - 3 ? 1 : 2;
        setBlockRaw(x, y, z, type);
      }
    }
  }

  for (let i = 0; i < 18; i += 1) {
    const x = Math.floor(Math.sin(i * 9.7) * 13);
    const z = Math.floor(Math.cos(i * 5.3) * 13);
    const y = terrainHeight(x, z) + 1;
    setBlockRaw(x, y, z, 3);
    setBlockRaw(x, y + 1, z, 3);
    setBlockRaw(x, y + 2, z, 3);
    setBlockRaw(x + 1, y + 3, z, 0);
    setBlockRaw(x - 1, y + 3, z, 0);
    setBlockRaw(x, y + 3, z + 1, 0);
    setBlockRaw(x, y + 3, z - 1, 0);
    setBlockRaw(x, y + 4, z, 0);
  }

  rebuildVisibleMeshes();
  player.position.set(0, terrainHeight(0, 0) + PLAYER_HEIGHT + 2, 0);
  velocity.set(0, 0, 0);
}

function createHighlight() {
  highlight = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 1.04), hoverMaterial);
  highlight.visible = false;
  scene.add(highlight);
}

function drawHotbar() {
  hotbar.innerHTML = "";
  blockTypes.forEach((block, index) => {
    const slot = document.createElement("button");
    slot.className = `slot${index === selectedBlock ? " selected" : ""}`;
    slot.title = block.name;
    slot.type = "button";
    slot.innerHTML = `
      <span class="slot-number">${index + 1}</span>
      <span class="block-preview" style="background:#${block.color.toString(16).padStart(6, "0")}"></span>
    `;
    slot.addEventListener("click", () => {
      selectedBlock = index;
      drawHotbar();
      setStatus(`Selected ${block.name}`);
    });
    hotbar.append(slot);
  });
}

function setStatus(text) {
  statusLine.textContent = text;
}

function updateCameraRotation() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function updatePlayerBox(position = player.position) {
  playerBox.min.set(position.x - PLAYER_RADIUS, position.y - PLAYER_HEIGHT, position.z - PLAYER_RADIUS);
  playerBox.max.set(position.x + PLAYER_RADIUS, position.y, position.z + PLAYER_RADIUS);
}

function intersectsWorld(position) {
  updatePlayerBox(position);
  const minX = Math.floor(playerBox.min.x - 0.5);
  const maxX = Math.floor(playerBox.max.x + 0.5);
  const minY = Math.floor(playerBox.min.y - 0.5);
  const maxY = Math.floor(playerBox.max.y + 0.5);
  const minZ = Math.floor(playerBox.min.z - 0.5);
  const maxZ = Math.floor(playerBox.max.z + 0.5);

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (!isOccupied(x, y, z)) continue;
        tempBox.min.set(x - 0.5, y - 0.5, z - 0.5);
        tempBox.max.set(x + 0.5, y + 0.5, z + 0.5);
        if (playerBox.intersectsBox(tempBox)) return true;
      }
    }
  }

  return false;
}

function tryMove(axis, amount) {
  if (amount === 0) return;
  const next = player.position.clone();
  next[axis] += amount;

  if (!intersectsWorld(next)) {
    player.position.copy(next);
    return;
  }

  if (axis === "y") {
    if (amount < 0) player.onGround = true;
    velocity.y = 0;
  }
}

function updateMovement(delta) {
  const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  const strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? SPRINT_SPEED : WALK_SPEED;

  tempVector.set(strafe, 0, -forward);
  if (tempVector.lengthSq() > 0) {
    tempVector.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
  }

  velocity.x = tempVector.x * speed;
  velocity.z = tempVector.z * speed;
  velocity.y -= GRAVITY * delta;
  player.onGround = false;

  tryMove("x", velocity.x * delta);
  tryMove("z", velocity.z * delta);
  tryMove("y", velocity.y * delta);

  if (player.position.y < -20) {
    player.position.set(0, terrainHeight(0, 0) + PLAYER_HEIGHT + 3, 0);
    velocity.set(0, 0, 0);
  }
}

function getTarget() {
  raycaster.setFromCamera(pointer, camera);
  let closestTarget = null;
  let closestDistance = REACH;
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;

  for (const block of targetMeshes) {
    tempBox.min.set(block.x - 0.5, block.y - 0.5, block.z - 0.5);
    tempBox.max.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
    const hitPoint = raycaster.ray.intersectBox(tempBox, tempVector);
    if (!hitPoint) continue;
    const distance = origin.distanceTo(hitPoint);
    if (distance >= closestDistance) continue;

    const localX = hitPoint.x - block.x;
    const localY = hitPoint.y - block.y;
    const localZ = hitPoint.z - block.z;
    const absX = Math.abs(localX);
    const absY = Math.abs(localY);
    const absZ = Math.abs(localZ);
    const normal = new THREE.Vector3(0, 0, 0);

    if (absX >= absY && absX >= absZ) {
      normal.x = Math.sign(localX || direction.x);
    } else if (absY >= absX && absY >= absZ) {
      normal.y = Math.sign(localY || direction.y);
    } else {
      normal.z = Math.sign(localZ || direction.z);
    }

    closestDistance = distance;
    closestTarget = { block, normal };
  }

  return closestTarget;
}

function updateHighlight() {
  const hit = getTarget();
  if (!hit) {
    highlight.visible = false;
    return;
  }
  highlight.visible = true;
  highlight.position.set(hit.block.x, hit.block.y, hit.block.z);
}

function breakTarget() {
  const hit = getTarget();
  if (!hit) return;
  const { x, y, z, typeIndex } = hit.block;
  if (y === 0) {
    setStatus("Bedrock layer stays put");
    return;
  }
  removeBlock(blockKey(x, y, z));
  setStatus(`Broke ${blockTypes[typeIndex].name}`);
}

function placeTarget() {
  const hit = getTarget();
  if (!hit) return;
  const position = tempVector.set(
    hit.block.x + hit.normal.x,
    hit.block.y + hit.normal.y,
    hit.block.z + hit.normal.z,
  );

  tempBox.min.set(position.x - 0.49, position.y - 0.49, position.z - 0.49);
  tempBox.max.set(position.x + 0.49, position.y + 0.49, position.z + 0.49);
  updatePlayerBox();
  if (tempBox.intersectsBox(playerBox)) {
    setStatus("Move back before placing there");
    return;
  }

  addBlock(position.x, position.y, position.z, selectedBlock);
  setStatus(`Placed ${blockTypes[selectedBlock].name}`);
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(now) {
  const delta = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  updateMovement(delta);
  camera.position.copy(player.position);
  updateCameraRotation();
  updateHighlight();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function lockPointer() {
  canvas.requestPointerLock();
}

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  overlay.classList.toggle("hidden", locked);
  setStatus(locked ? "Explore, dig, and build" : "Click to resume");
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= event.movementX * 0.0026;
  player.pitch -= event.movementY * 0.0026;
  player.pitch = Math.max(-Math.PI / 2 + 0.04, Math.min(Math.PI / 2 - 0.04, player.pitch));
});

document.addEventListener("keydown", (event) => {
  keys.add(event.code);

  if (event.code === "Space" && player.onGround) {
    velocity.y = JUMP_SPEED;
    player.onGround = false;
  }

  if (event.code.startsWith("Digit")) {
    const index = Number(event.code.slice(5)) - 1;
    if (blockTypes[index]) {
      selectedBlock = index;
      drawHotbar();
      setStatus(`Selected ${blockTypes[index].name}`);
    }
  }

  if (event.code === "KeyR") {
    buildWorld();
    setStatus("World reset");
  }
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

canvas.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) lockPointer();
});

overlay.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) lockPointer();
});

document.addEventListener("mousedown", (event) => {
  if (document.pointerLockElement !== canvas) return;
  if (event.button === 0) breakTarget();
  if (event.button === 2) placeTarget();
});

document.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resize);

buildWorld();
createHighlight();
drawHotbar();
updateCameraRotation();
requestAnimationFrame(animate);
