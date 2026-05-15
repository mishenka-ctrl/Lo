import * as THREE from "https://esm.sh/three@0.164.1";

const canvas = document.querySelector("#world");
const overlay = document.querySelector("#overlay");
const hotbar = document.querySelector("#hotbar");
const statusLine = document.querySelector("#status");

const WORLD_SIZE = 32;
const MAX_HEIGHT = 10;
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const sun = new THREE.DirectionalLight(0xfff0c4, 2.4);
sun.position.set(18, 34, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -42;
sun.shadow.camera.right = 42;
sun.shadow.camera.top = 42;
sun.shadow.camera.bottom = -42;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x476d3f, 1.55));

const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const pointer = new THREE.Vector2(0, 0);
const tempVector = new THREE.Vector3();
const tempBox = new THREE.Box3();
const playerBox = new THREE.Box3();
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
const world = new Map();
const blockMeshes = new Map();
const collidableBoxes = new Map();
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

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function unpackKey(key) {
  return key.split(",").map(Number);
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

function terrainHeight(x, z) {
  const rolling = Math.sin(x * 0.38) * 1.8 + Math.cos(z * 0.31) * 1.6;
  const hills = Math.sin((x + z) * 0.18) * 1.2 + Math.cos((x - z) * 0.24);
  return Math.max(2, Math.min(MAX_HEIGHT, Math.round(5 + rolling + hills)));
}

function addBlock(x, y, z, typeIndex = 0) {
  const key = blockKey(x, y, z);
  if (world.has(key)) return;

  const mesh = new THREE.Mesh(blockGeometry, materials[typeIndex]);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.key = key;
  mesh.userData.typeIndex = typeIndex;
  world.set(key, typeIndex);
  blockMeshes.set(key, mesh);
  collidableBoxes.set(key, new THREE.Box3().setFromObject(mesh));
  scene.add(mesh);
}

function removeBlock(key) {
  const mesh = blockMeshes.get(key);
  if (!mesh) return;
  scene.remove(mesh);
  blockMeshes.delete(key);
  collidableBoxes.delete(key);
  world.delete(key);
}

function buildWorld() {
  [...blockMeshes.keys()].forEach(removeBlock);

  for (let x = -WORLD_SIZE / 2; x < WORLD_SIZE / 2; x += 1) {
    for (let z = -WORLD_SIZE / 2; z < WORLD_SIZE / 2; z += 1) {
      const height = terrainHeight(x, z);
      for (let y = 0; y <= height; y += 1) {
        const type = y === height ? 0 : y > height - 3 ? 1 : 2;
        addBlock(x, y, z, type);
      }
    }
  }

  for (let i = 0; i < 32; i += 1) {
    const x = Math.floor(Math.sin(i * 9.7) * 13);
    const z = Math.floor(Math.cos(i * 5.3) * 13);
    const y = terrainHeight(x, z) + 1;
    addBlock(x, y, z, 3);
    addBlock(x, y + 1, z, 3);
    addBlock(x, y + 2, z, 3);
    addBlock(x + 1, y + 3, z, 0);
    addBlock(x - 1, y + 3, z, 0);
    addBlock(x, y + 3, z + 1, 0);
    addBlock(x, y + 3, z - 1, 0);
    addBlock(x, y + 4, z, 0);
  }

  player.position.set(0, terrainHeight(0, 0) + PLAYER_HEIGHT + 2, 0);
  velocity.set(0, 0, 0);
}

function createHighlight() {
  const geometry = new THREE.BoxGeometry(1.04, 1.04, 1.04);
  const edges = new THREE.EdgesGeometry(geometry);
  highlight = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
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
  for (const box of collidableBoxes.values()) {
    if (playerBox.intersectsBox(box)) return true;
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
  const hits = raycaster.intersectObjects([...blockMeshes.values()], false);
  return hits[0] ?? null;
}

function updateHighlight() {
  const hit = getTarget();
  if (!hit) {
    highlight.visible = false;
    return;
  }
  highlight.visible = true;
  highlight.position.copy(hit.object.position);
}

function breakTarget() {
  const hit = getTarget();
  if (!hit) return;
  const [, y] = unpackKey(hit.object.userData.key);
  if (y === 0) {
    setStatus("Bedrock layer stays put");
    return;
  }
  removeBlock(hit.object.userData.key);
  setStatus(`Broke ${blockTypes[hit.object.userData.typeIndex].name}`);
}

function placeTarget() {
  const hit = getTarget();
  if (!hit || !hit.face) return;
  const position = hit.object.position.clone().add(hit.face.normal);
  position.round();

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
