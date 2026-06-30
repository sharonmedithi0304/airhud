import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

/* ============================================================
   DOM REFS
============================================================ */
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const cursorLayer = document.getElementById("cursorLayer");
const octx = overlay.getContext("2d");
const cctx = cursorLayer.getContext("2d");

const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");

const statHands = document.getElementById("statHands");
const statFps = document.getElementById("statFps");
const statCam = document.getElementById("statCam");

const gestureIcon = document.getElementById("gestureIcon");
const gestureName = document.getElementById("gestureName");
const gestureSub = document.getElementById("gestureSub");

const modeDock = document.getElementById("modeDock");
const keyboardDock = document.getElementById("keyboardDock");
const keyboardEl = document.getElementById("keyboard");
const typedOutput = document.getElementById("typedOutput");
const clearTyped = document.getElementById("clearTyped");

const sensSlider = document.getElementById("sensSlider");
const smoothSlider = document.getElementById("smoothSlider");
const soundToggle = document.getElementById("soundToggle");
const voiceToggle = document.getElementById("voiceToggle");
const skeletonToggle = document.getElementById("skeletonToggle");

const logList = document.getElementById("logList");
const themeRail = document.getElementById("themeRail");

/* ============================================================
   STATE
============================================================ */
let handLandmarker = null;
let mode = "mouse"; // "mouse" | "keyboard"
let lastVideoTime = -1;
let smoothedCursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let pinchCharge = 0; // 0..1 reticle charge
let isPinching = false;
let isDragging = false;
let dragStart = null;
let lastScrollY = null;
let lastGestureLabel = "";
let frameTimes = [];
let audioCtx = null;

const FINGER_TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

/* ============================================================
   LOGGING
============================================================ */
function log(msg){
  const time = new Date().toLocaleTimeString([], {hour12:false});
  const row = document.createElement("div");
  row.innerHTML = `<span class="t">${time}</span><span>${msg}</span>`;
  logList.prepend(row);
  while(logList.children.length > 40) logList.removeChild(logList.lastChild);
}

/* ============================================================
   SOUND + VOICE FEEDBACK
============================================================ */
function ensureAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function blip(freq=880, dur=0.06, gain=0.05){
  if(!soundToggle.checked) return;
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.stop(audioCtx.currentTime + dur + 0.02);
}
function speak(text){
  if(!voiceToggle.checked) return;
  if(!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1; u.pitch = 1.0; u.volume = 0.7;
  window.speechSynthesis.speak(u);
}

/* ============================================================
   THEME
============================================================ */
themeRail.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-dot");
  if(!btn) return;
  document.body.dataset.theme = btn.dataset.theme;
  [...themeRail.children].forEach(c => c.classList.toggle("active", c === btn));
});
themeRail.children[0].classList.add("active");

/* ============================================================
   MODE SWITCHING
============================================================ */
modeDock.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-pill");
  if(!btn) return;
  mode = btn.dataset.mode;
  [...modeDock.children].forEach(c => c.classList.toggle("active", c === btn));
  keyboardDock.classList.toggle("visible", mode === "keyboard");
  log(`Mode → <b>${mode}</b>`);
});

/* ============================================================
   VIRTUAL KEYBOARD BUILD
============================================================ */
const KEY_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["Z","X","C","V","B","N","M","⌫"],
];
let typedText = "";

function buildKeyboard(){
  keyboardEl.innerHTML = "";
  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach(k => {
      const keyEl = document.createElement("div");
      keyEl.className = "kb-key" + (k === "⌫" ? " wide" : "");
      keyEl.dataset.key = k;
      keyEl.textContent = k;
      const charge = document.createElement("div");
      charge.className = "charge";
      keyEl.appendChild(charge);
      rowEl.appendChild(keyEl);
    });
    keyboardEl.appendChild(rowEl);
  });
  const spaceRow = document.createElement("div");
  spaceRow.className = "kb-row";
  const spaceKey = document.createElement("div");
  spaceKey.className = "kb-key space";
  spaceKey.dataset.key = "SPACE";
  spaceKey.textContent = "SPACE";
  const charge = document.createElement("div");
  charge.className = "charge";
  spaceKey.appendChild(charge);
  spaceRow.appendChild(spaceKey);
  keyboardEl.appendChild(spaceRow);
}
buildKeyboard();

clearTyped.addEventListener("click", () => {
  typedText = "";
  typedOutput.textContent = "";
});

function pressKey(key){
  if(key === "⌫") typedText = typedText.slice(0, -1);
  else if(key === "SPACE") typedText += " ";
  else typedText += key;
  typedOutput.textContent = typedText;
  blip(1200, 0.05, 0.06);
  log(`Typed key <b>${key}</b>`);
}

/* ============================================================
   GESTURE CLASSIFICATION
============================================================ */
function dist(a, b){
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z||0) - (b.z||0));
}

function fingerExtended(landmarks, tipIdx, pipIdx, wristIdx=0){
  // crude: tip further from wrist than pip => extended
  return dist(landmarks[tipIdx], landmarks[wristIdx]) > dist(landmarks[pipIdx], landmarks[wristIdx]) * 1.05;
}

function classifyHand(landmarks){
  const idxExt = fingerExtended(landmarks, 8, 6);
  const midExt = fingerExtended(landmarks, 12, 10);
  const ringExt = fingerExtended(landmarks, 16, 14);
  const pinkyExt = fingerExtended(landmarks, 20, 18);
  const thumbTip = landmarks[4], indexTip = landmarks[8];
  const pinchDist = dist(thumbTip, indexTip);

  const extCount = [idxExt, midExt, ringExt, pinkyExt].filter(Boolean).length;

  let gesture = "point";
  if(pinchDist < 0.045) gesture = "pinch";
  else if(idxExt && midExt && !ringExt && !pinkyExt) gesture = "peace";
  else if(extCount === 0) gesture = "fist";
  else if(extCount === 4) gesture = "palm";

  return { gesture, pinchDist, idxExt, midExt, ringExt, pinkyExt };
}

const GESTURE_META = {
  idle:   { icon:"—", label:"Idle",   sub:"Show a hand to begin" },
  point:  { icon:"☝", label:"Point",  sub:"Move to steer the cursor" },
  pinch:  { icon:"🤏", label:"Pinch",  sub:"Click / type engaged" },
  peace:  { icon:"✌",  label:"Peace",  sub:"Move vertically to scroll" },
  fist:   { icon:"✊", label:"Fist",   sub:"Hold to drag" },
  palm:   { icon:"🖐", label:"Palm",   sub:"Spread two hands to zoom" },
};

function setGestureUI(key){
  const meta = GESTURE_META[key] || GESTURE_META.idle;
  gestureIcon.textContent = meta.icon;
  gestureName.textContent = meta.label;
  gestureSub.textContent = meta.sub;
  if(key !== lastGestureLabel){
    lastGestureLabel = key;
    if(key !== "idle") speak(meta.label);
  }
}

/* ============================================================
   DRAWING — SKELETON + CURSOR/RETICLE
============================================================ */
function resizeCanvases(){
  [overlay, cursorLayer].forEach(c => {
    c.width = video.clientWidth;
    c.height = video.clientHeight;
  });
}
window.addEventListener("resize", resizeCanvases);

function drawSkeleton(landmarksList){
  octx.clearRect(0,0,overlay.width, overlay.height);
  if(!skeletonToggle.checked) return;
  const styleColor = getComputedStyle(document.body).getPropertyValue("--signal").trim();
  landmarksList.forEach(landmarks => {
    octx.save();
    // mirror to match mirrored video
    octx.translate(overlay.width, 0);
    octx.scale(-1, 1);

    octx.strokeStyle = styleColor;
    octx.lineWidth = 2.4;
    octx.shadowColor = styleColor;
    octx.shadowBlur = 10;
    octx.beginPath();
    HAND_CONNECTIONS.forEach(([a,b]) => {
      const pa = landmarks[a], pb = landmarks[b];
      octx.moveTo(pa.x*overlay.width, pa.y*overlay.height);
      octx.lineTo(pb.x*overlay.width, pb.y*overlay.height);
    });
    octx.stroke();

    landmarks.forEach((p,i) => {
      const r = (i===8||i===4) ? 5 : 3;
      octx.beginPath();
      octx.fillStyle = (i===8||i===4) ? styleColor : "rgba(255,255,255,0.85)";
      octx.arc(p.x*overlay.width, p.y*overlay.height, r, 0, Math.PI*2);
      octx.fill();
    });
    octx.restore();
  });
}

function drawCursor(x, y, charge, active){
  cctx.clearRect(0,0,cursorLayer.width, cursorLayer.height);
  const styleColor = getComputedStyle(document.body).getPropertyValue("--signal").trim();

  // outer reticle ring
  cctx.beginPath();
  cctx.arc(x, y, 18, 0, Math.PI*2);
  cctx.strokeStyle = "rgba(255,255,255,0.25)";
  cctx.lineWidth = 1.5;
  cctx.stroke();

  // charge arc
  cctx.beginPath();
  cctx.arc(x, y, 18, -Math.PI/2, -Math.PI/2 + charge*Math.PI*2);
  cctx.strokeStyle = styleColor;
  cctx.lineWidth = 3;
  cctx.shadowColor = styleColor;
  cctx.shadowBlur = 12;
  cctx.stroke();

  // center dot
  cctx.beginPath();
  cctx.arc(x, y, active ? 7 : 4, 0, Math.PI*2);
  cctx.fillStyle = active ? styleColor : "rgba(255,255,255,0.9)";
  cctx.shadowBlur = active ? 16 : 0;
  cctx.fill();
}

/* ============================================================
   KEYBOARD HIT-TESTING
============================================================ */
function hitTestKeyboard(clientX, clientY){
  const keys = keyboardEl.querySelectorAll(".kb-key");
  for(const k of keys){
    const r = k.getBoundingClientRect();
    if(clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom){
      return k;
    }
  }
  return null;
}
let hoveredKey = null;
let keyChargeStart = null;

/* ============================================================
   MAIN PROCESSING LOOP
============================================================ */
let twoHandBaseline = null;
let pageZoom = 1;

function processResults(result){
  const landmarksList = result.landmarks || [];
  statHands.textContent = `${landmarksList.length} HAND${landmarksList.length===1?"":"S"}`;
  statHands.classList.toggle("live", landmarksList.length > 0);

  drawSkeleton(landmarksList);

  if(landmarksList.length === 0){
    setGestureUI("idle");
    cctx.clearRect(0,0,cursorLayer.width, cursorLayer.height);
    isPinching = false; pinchCharge = 0; isDragging = false;
    if(hoveredKey){ hoveredKey.classList.remove("hover"); hoveredKey = null; }
    return;
  }

  // ===== TWO-HAND ZOOM =====
  if(landmarksList.length === 2){
    const c0 = classifyHand(landmarksList[0]);
    const c1 = classifyHand(landmarksList[1]);
    if(c0.gesture === "pinch" && c1.gesture === "pinch"){
      const p0 = landmarksList[0][8], p1 = landmarksList[1][8];
      const d = dist(p0, p1);
      if(twoHandBaseline === null) twoHandBaseline = d;
      const ratio = d / twoHandBaseline;
      pageZoom = Math.min(2, Math.max(0.6, ratio));
      document.querySelector(".stage").style.zoom = pageZoom.toFixed(2);
      setGestureUI("palm");
      gestureName.textContent = "Zoom";
      gestureSub.textContent = `${Math.round(pageZoom*100)}%`;
      return;
    } else {
      twoHandBaseline = null;
    }
  } else {
    twoHandBaseline = null;
  }

  // ===== PRIMARY HAND (first detected) =====
  const landmarks = landmarksList[0];
  const cls = classifyHand(landmarks);
  setGestureUI(cls.gesture === "point" ? "point" : cls.gesture);

  const sens = parseFloat(sensSlider.value);
  const smooth = parseFloat(smoothSlider.value);

  // mirror x because video is mirrored
  const rawX = (1 - landmarks[8].x) * window.innerWidth;
  const rawY = landmarks[8].y * window.innerHeight;

  // sensitivity: scale movement around center
  const cx = window.innerWidth/2, cy = window.innerHeight/2;
  const targetX = cx + (rawX - cx) * sens;
  const targetY = cy + (rawY - cy) * sens;

  smoothedCursor.x += (targetX - smoothedCursor.x) * (1 - smooth);
  smoothedCursor.y += (targetY - smoothedCursor.y) * (1 - smooth);

  const sx = Math.min(window.innerWidth-2, Math.max(2, smoothedCursor.x));
  const sy = Math.min(window.innerHeight-2, Math.max(2, smoothedCursor.y));

  // ===== PINCH CHARGE / CLICK =====
  const pinchNow = cls.gesture === "pinch";
  if(pinchNow){
    pinchCharge = Math.min(1, pinchCharge + 0.18);
  } else {
    pinchCharge = Math.max(0, pinchCharge - 0.12);
  }

  drawCursor(sx, sy, pinchCharge, pinchNow);

  if(mode === "keyboard"){
    const k = hitTestKeyboard(sx, sy);
    if(k !== hoveredKey){
      if(hoveredKey) hoveredKey.classList.remove("hover");
      hoveredKey = k;
      if(hoveredKey) hoveredKey.classList.add("hover");
      keyChargeStart = null;
    }
    if(hoveredKey){
      const charge = hoveredKey.querySelector(".charge");
      charge.style.opacity = pinchCharge;
      charge.style.transform = `scale(${0.8 + pinchCharge*0.25})`;
      if(pinchCharge >= 1 && !hoveredKey.classList.contains("pressed")){
        hoveredKey.classList.add("pressed");
        pressKey(hoveredKey.dataset.key);
        setTimeout(()=>hoveredKey && hoveredKey.classList.remove("pressed"), 160);
      }
    }
  } else {
    // MOUSE MODE
    if(pinchCharge >= 1 && !isPinching){
      isPinching = true;
      blip(620, 0.07, 0.07);
      log("Click");
      const el = document.elementFromPoint(sx, sy);
      if(el && el.click) el.click();
    } else if(!pinchNow){
      isPinching = false;
    }
  }

  // ===== PEACE = SCROLL =====
  if(cls.gesture === "peace"){
    const wristY = landmarks[0].y;
    if(lastScrollY !== null){
      const delta = (wristY - lastScrollY) * window.innerHeight * 6;
      if(Math.abs(delta) > 1) window.scrollBy(0, delta);
    }
    lastScrollY = wristY;
  } else {
    lastScrollY = null;
  }

  // ===== FIST = DRAG =====
  if(cls.gesture === "fist"){
    if(!isDragging){
      isDragging = true;
      dragStart = { x: sx, y: sy, scrollY: window.scrollY };
      log("Drag start");
    } else {
      const dx = sx - dragStart.x;
      window.scrollTo(0, dragStart.scrollY - dx*0); // reserved (placeholder no horizontal page scroll)
    }
  } else if(isDragging){
    isDragging = false;
    log("Drag end");
  }
}

/* ============================================================
   CAMERA + MODEL INIT
============================================================ */
async function initModel(){
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

async function startCamera(){
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" }
  });
  video.srcObject = stream;
  await new Promise(res => video.onloadedmetadata = res);
  video.play();
  statCam.classList.add("live");
}

function loop(){
  requestAnimationFrame(loop);
  if(video.readyState < 2 || !handLandmarker) return;
  if(video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = handLandmarker.detectForVideo(video, now);
  processResults(result);

  frameTimes.push(now);
  frameTimes = frameTimes.filter(t => now - t < 1000);
  statFps.textContent = `${frameTimes.length} FPS`;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Loading model…";
  try{
    await Promise.all([initModel(), startCamera()]);
    resizeCanvases();
    startOverlay.classList.add("hidden");
    log("System online — tracking started");
    requestAnimationFrame(loop);
  } catch(err){
    console.error(err);
    startBtn.textContent = "Camera/model failed — retry";
    startBtn.disabled = false;
    log(`Error: ${err.message}`);
  }
});

window.addEventListener("load", resizeCanvases);