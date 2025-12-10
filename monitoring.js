// Application state
const appState = {
  focusScore: 100,
  leaningStartTime: null,
  leaningDuration: 0,
  lookingAwayCount: 0,
  focusStreak: 0,
  sessionStartTime: null,
  sessionDuration: 0,
  lastFocusCheck: Date.now(),
  alertLevel: 1,
  raisedHandStartTime: null,
  isCalibrating: false,
  calibrationEndTime: null,
  consecutiveFocusedFrames: 0,
  consecutiveDistractedFrames: 0,
  lastLabel: "",
  stabilityCounter: 0,
  isTabVisible: true,
  tabHiddenTime: null,
  awayTimeThreshold: 30000,
  audioUnlocked: false
};

const focusScoreEl = document.getElementById("focusScore");
const progressFillEl = document.getElementById("progressFill");
const leaningTimeEl = document.getElementById("leaningTime");
const lookingAwayCountEl = document.getElementById("lookingAwayCount");
const focusStreakEl = document.getElementById("focusStreak");
const alertBoxEl = document.getElementById("alertBox");
const gestureInfoEl = document.getElementById("gestureInfo");
const calibrationMessageEl = document.getElementById("calibrationMessage");
const URL = "https://teachablemachine.withgoogle.com/models/gsUPVRVRH/";

let model, webcam, ctx, labelContainer, maxPredictions;
let aud = document.getElementById("wakeUpAudio");

// ------------------- Audio Handling -------------------
async function unlockAudioAsync() {
  if (appState.audioUnlocked) return true;
  if (!aud) aud = document.getElementById("wakeUpAudio");
  if (!aud) return false;

  try {
    aud.volume = 1;
    aud.muted = false;
    await aud.play();
    aud.pause();
    aud.currentTime = 0;
    appState.audioUnlocked = true;
    console.log("✅ Audio unlocked");
    return true;
  } catch (e) {
    console.error("Audio unlock failed:", e.message);
    try { aud.load(); appState.audioUnlocked = true; return true; } 
    catch { return false; }
  }
}

function playAud() {
  if (!aud) aud = document.getElementById("wakeUpAudio");
  if (appState.audioUnlocked && aud) {
    aud.currentTime = 0;
    aud.play().catch(() => { appState.audioUnlocked = false; unlockAudioAsync(); });
  }
}

function pauseAud() {
  if (aud) { aud.pause(); aud.currentTime = 0; }
}

// ------------------- Visibility -------------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    appState.isTabVisible = false;
    appState.tabHiddenTime = Date.now();
  } else {
    appState.isTabVisible = true;
    if (appState.tabHiddenTime && !appState.isCalibrating) {
      const timeAway = Date.now() - appState.tabHiddenTime;
      if (timeAway > appState.awayTimeThreshold) {
        const penalty = Math.min(Math.floor(timeAway / 10000) * 2, 20);
        appState.focusScore = Math.max(appState.focusScore - penalty, 0);
        focusScoreEl.textContent = appState.focusScore;
        progressFillEl.style.width = `${appState.focusScore}%`;

        appState.lookingAwayCount += Math.floor(timeAway / appState.awayTimeThreshold);
        lookingAwayCountEl.textContent = appState.lookingAwayCount;

        triggerAlert(`You were away for ${Math.floor(timeAway / 1000)} seconds. Stay focused!`);
      }
    }
    appState.tabHiddenTime = null;
  }
});

// ------------------- App Start -------------------
async function startApp() {
  document.removeEventListener("click", startApp);
  document.removeEventListener("touchstart", startApp);

  // Unlock audio
  await unlockAudioAsync();

  // Load Teachable Machine model
  const modelURL = URL + "model.json";
  const metadataURL = URL + "metadata.json";
  model = await tmPose.load(modelURL, metadataURL);
  maxPredictions = model.getTotalClasses();

  // Setup webcam
  const size = 400, flip = true;
  webcam = new tmPose.Webcam(size, size, flip);
  await webcam.setup(); // ✅ iOS will prompt here
  await webcam.play();

  const canvas = document.getElementById("canvas");
  canvas.width = size;
  canvas.height = size;
  ctx = canvas.getContext("2d");

  labelContainer = document.getElementById("label-container");
  labelContainer.innerHTML = "";
  for (let i = 0; i < maxPredictions; i++) {
    const div = document.createElement("div");
    div.className = "prediction-item";
    div.id = `pred-item-${i}`;
    div.innerHTML = `
      <div class="prediction-label" id="class${i}"></div>
      <div class="prediction-value" id="probability${i}">0%</div>
    `;
    labelContainer.appendChild(div);
  }

  startCalibration();
  window.requestAnimationFrame(loop);
  setInterval(updateFocusTracking, 2000);
}

// Wait for first user interaction
document.addEventListener("click", startApp, { once: true });
document.addEventListener("touchstart", startApp, { once: true });

// ------------------- Calibration -------------------
function startCalibration() {
  appState.isCalibrating = true;
  appState.calibrationEndTime = Date.now() + 10000;
  calibrationMessageEl.style.display = "block";

  setTimeout(() => {
    appState.isCalibrating = false;
    calibrationMessageEl.style.display = "none";
    appState.sessionStartTime = Date.now();
  }, 10000);
}

// ------------------- Main Loop -------------------
async function loop() {
  if (webcam) {
    webcam.update();
    await predict();
  }
  window.requestAnimationFrame(loop);
}

async function predict() {
  if (!model || !webcam) return;
  const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
  const prediction = await model.predict(posenetOutput);

  let maxProb = 0, maxIndex = 0;
  for (let i = 0; i < maxPredictions; i++) {
    const probability = prediction[i].probability.toFixed(2);
    document.getElementById(`class${i}`).innerHTML = prediction[i].className;
    document.getElementById(`probability${i}`).innerHTML = `${(probability*100).toFixed(0)}%`;

    const predItem = document.getElementById(`pred-item-${i}`);
    if (probability > maxProb) { maxProb = probability; maxIndex = i; }
    predItem.classList.remove("active");
  }
  document.getElementById(`pred-item-${maxIndex}`).classList.add("active");

  if (!appState.isCalibrating) {
    trackBehaviors(prediction, pose);
    updateFocusScore(prediction);
  }

  drawPose(pose);
}

// ------------------- Behaviors -------------------
function trackBehaviors(prediction, pose) {
  const currentTime = Date.now();

  // Leaning
  const leaningProbability = getProbabilityForClass(prediction, "leaning");
  if (leaningProbability > 0.7) {
    if (appState.leaningStartTime === null) appState.leaningStartTime = currentTime;
    else {
      appState.leaningDuration = Math.floor((currentTime - appState.leaningStartTime)/1000);
      if (appState.leaningDuration > 8) triggerAlert("Please sit up straight to maintain focus.", true);
    }
  } else { appState.leaningStartTime = null; appState.leaningDuration = 0; }

  // Looking down
  const lookingDownProbability = getProbabilityForClass(prediction, "looking down");
  if (lookingDownProbability > 0.7 && (!appState.recentLookDown || currentTime - appState.recentLookDown > 8000)) {
    triggerAlert("Keep your head up and stay focused!", true);
    appState.recentLookDown = currentTime;
  }

  // Leaning on hand
  const leaningOnHandProbability = getProbabilityForClass(prediction, "leaning on hand");
  if (leaningOnHandProbability > 0.7 && (!appState.recentLeanHand || currentTime - appState.recentLeanHand > 8000)) {
    triggerAlert("Please don't lean on your hand. Sit up straight!", true);
    appState.recentLeanHand = currentTime;
  }

  // Looking away
  const lookingAwayProbability = getProbabilityForClass(prediction, "looking away");
  if (lookingAwayProbability > 0.7 && (!appState.recentLookAway || currentTime - appState.recentLookAway > 5000)) {
    appState.lookingAwayCount++;
    appState.recentLookAway = currentTime;
    if (appState.lookingAwayCount % 3 === 0) {
      appState.alertLevel = Math.min(appState.alertLevel + 1, 3);
      triggerAdaptiveAlert();
    }
  }

  // Raised hand
  const raisedHandProbability = getProbabilityForClass(prediction, "raise hand");
  if (raisedHandProbability > 0.9) {
    if (appState.raisedHandStartTime === null) appState.raisedHandStartTime = currentTime;
    else if (currentTime - appState.raisedHandStartTime > 1000) gestureInfoEl.style.display = "block";
  } else { appState.raisedHandStartTime = null; gestureInfoEl.style.display = "none"; }

  leaningTimeEl.textContent = appState.leaningDuration + "s";
  lookingAwayCountEl.textContent = appState.lookingAwayCount;
}

// ------------------- Focus Score -------------------
function updateFocusScore(prediction) {
  const now = Date.now();
  if (now - appState.lastFocusCheck < 500) return;
  appState.lastFocusCheck = now;

  const topClass = getTopClass(prediction);
  const label = topClass.className.toLowerCase();
  const safeLabels = ["focused","raise hand","raised hand","default"];
  const isSafe = safeLabels.some(safe => label.includes(safe));

  if (label !== appState.lastLabel) appState.stabilityCounter = 0;
  else appState.stabilityCounter++;
  appState.lastLabel = label;

  const isStable = appState.stabilityCounter >= 2;
  if (isStable && (label.includes("focused")||label.includes("default")||label.includes("raise hand")||label.includes("raised hand"))) {
    appState.consecutiveFocusedFrames++;
    if (appState.consecutiveFocusedFrames >= 3) { appState.focusScore = Math.min(appState.focusScore+2,100); appState.consecutiveFocusedFrames=0; }
  } else if (isStable && !isSafe) {
    appState.consecutiveDistractedFrames++;
    if (appState.consecutiveDistractedFrames >= 5) { appState.focusScore = Math.max(appState.focusScore-3,0); appState.consecutiveDistractedFrames=0; }
  }

  focusScoreEl.textContent = appState.focusScore;
  progressFillEl.style.width = `${appState.focusScore}%`;
}

// ------------------- Utilities -------------------
function updateFocusTracking() {
  if (appState.isCalibrating) return;
  if (appState.sessionStartTime) {
    appState.focusStreak = Math.floor((Date.now() - appState.sessionStartTime)/60000);
    focusStreakEl.textContent = appState.focusStreak;
  }
}

function getProbabilityForClass(prediction,className) {
  for (let i=0;i<prediction.length;i++) if (prediction[i].className.toLowerCase().includes(className.toLowerCase())) return prediction[i].probability;
  return 0;
}

function getTopClass(prediction) { return prediction.reduce((a,b)=>a.probability>b.probability?a:b); }

function triggerAdaptiveAlert() {
  const messages = [
    "Gentle reminder: Try to maintain focus on your studies.",
    "You're getting distracted frequently. Let's refocus.",
    "Important: Your focus is dropping significantly. Consider taking a short break."
  ];
  alertBoxEl.textContent = messages[Math.min(appState.alertLevel-1,messages.length-1)];
  alertBoxEl.style.display = "block";
  alertBoxEl.className = "alert-box";
  if (appState.alertLevel >= 2) alertBoxEl.classList.add("warning");
  if (appState.alertLevel >= 3) alertBoxEl.classList.add("alert");
  if (appState.alertLevel >= 2) playAud();
  setTimeout(()=>{ alertBoxEl.style.display="none"; pauseAud(); },5000);
}

function drawPose(pose) {
  if (webcam?.canvas) {
    ctx.drawImage(webcam.canvas,0,0);
    if (pose) { const minConfidence=0.5; tmPose.drawKeypoints(pose.keypoints,minConfidence,ctx); tmPose.drawSkeleton(pose.keypoints,minConfidence,ctx);}
  }
}

function triggerAlert(message,playSound=false) {
  alertBoxEl.textContent=message;
  alertBoxEl.style.display="block";
  alertBoxEl.className="alert-box warning";
  if (playSound) playAud();
  setTimeout(()=>{ alertBoxEl.style.display="none"; if(playSound) pauseAud(); },3000);
}
