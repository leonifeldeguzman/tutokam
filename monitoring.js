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

let aud = null;

// Wait for DOM to be ready before accessing audio
document.addEventListener('DOMContentLoaded', function() {
  aud = document.getElementById("wakeUpAudio");
  if (aud) {
    aud.load(); // Preload the audio
    console.log("Audio element loaded");
  }
});

// Async function to unlock audio - WAIT FOR THIS TO COMPLETE
async function unlockAudioAsync() {
  if (appState.audioUnlocked) {
    console.log("Audio already unlocked");
    return true;
  }
  
  if (!aud) {
    aud = document.getElementById("wakeUpAudio");
  }
  
  if (!aud) {
    console.error("Audio element not found!");
    return false;
  }

  console.log("🔓 Attempting to unlock audio...");
  
  try {
    aud.volume = 1.0;
    aud.muted = false;
    
    // CRITICAL: Actually wait for the play to complete
    await aud.play();
    console.log("✅ Audio played");
    
    aud.pause();
    aud.currentTime = 0;
    
    appState.audioUnlocked = true;
    console.log("✅ Audio unlocked successfully!");
    return true;
  } catch (e) {
    console.error("❌ Audio unlock failed:", e.message);
    
    // Try alternative method
    try {
      aud.load();
      appState.audioUnlocked = true;
      return true;
    } catch (e2) {
      console.error("❌ Alternative unlock failed:", e2.message);
      return false;
    }
  }
}

// Add event listeners for any user interaction
let interactionAttempted = false;

function attemptUnlock() {
  if (!interactionAttempted) {
    interactionAttempted = true;
    console.log("User interaction detected");
    unlockAudioAsync();
  }
}

document.addEventListener('click', attemptUnlock, { once: false });
document.addEventListener('touchstart', attemptUnlock, { once: false });
document.addEventListener('keydown', attemptUnlock, { once: false });

function playAud() { 
  console.log("🔊 Attempting to play audio... audioUnlocked:", appState.audioUnlocked);
  
  if (!aud) {
    aud = document.getElementById("wakeUpAudio");
    console.error("Audio element was null, trying to get it again");
  }
  
  if (!aud) {
    console.error("❌ Audio element still not found!");
    return;
  }
  
  if (appState.audioUnlocked) {
    aud.currentTime = 0;
    aud.volume = 1.0;
    
    const playPromise = aud.play();
    
    if (playPromise !== undefined) {
      playPromise.then(() => {
        console.log("✅ Audio playing successfully");
      }).catch(e => {
        console.error("❌ Audio play failed:", e.message);
        appState.audioUnlocked = false;
        unlockAudioAsync();
      });
    }
  } else {
    console.warn("⚠️ Audio not unlocked, attempting unlock now...");
    unlockAudioAsync().then(() => {
      // Try playing again after unlock
      if (appState.audioUnlocked) {
        playAud();
      }
    });
  }
}

function pauseAud() { 
  if (aud) {
    aud.pause(); 
    aud.currentTime = 0;
  }
}

document.addEventListener('visibilitychange', handleVisibilityChange);

function handleVisibilityChange() {
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
}

async function init() {
  try {
    console.log("🚀 Initializing...");
    
    // CRITICAL: Wait for audio to unlock before continuing
    const audioUnlocked = await unlockAudioAsync();
    
    if (!audioUnlocked) {
      alert("⚠️ Audio alerts may not work. Please click anywhere on the page to enable sound.");
    } else {
      console.log("✅ Audio ready!");
    }
    
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";
    model = await tmPose.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    const size = 400;
    const flip = true;
    webcam = new tmPose.Webcam(size, size, flip);
    await webcam.setup();
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
    
    console.log("✅ Initialization complete!");
  } catch (error) {
    console.error("Error initializing:", error);
    alert("Failed to initialize the application. Please check your camera permissions.");
  }
}

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

  let maxProb = 0;
  let maxIndex = 0;

  for (let i = 0; i < maxPredictions; i++) {
    const probability = prediction[i].probability.toFixed(2);
    document.getElementById(`class${i}`).innerHTML = prediction[i].className;
    document.getElementById(`probability${i}`).innerHTML = `${(probability * 100).toFixed(0)}%`;
    
    const predItem = document.getElementById(`pred-item-${i}`);
    if (probability > maxProb) {
      maxProb = probability;
      maxIndex = i;
    }
    predItem.classList.remove("active");
  }
  
  document.getElementById(`pred-item-${maxIndex}`).classList.add("active");

  if (!appState.isCalibrating) {
    trackBehaviors(prediction, pose);
    updateFocusScore(prediction);
  }

  drawPose(pose);
}

function trackBehaviors(prediction, pose) {
  const currentTime = Date.now();
  const leaningProbability = getProbabilityForClass(prediction, "leaning");
  
  if (leaningProbability > 0.7) {
    if (appState.leaningStartTime === null) {
      appState.leaningStartTime = currentTime;
    } else {
      appState.leaningDuration = Math.floor((currentTime - appState.leaningStartTime) / 1000);
      if (appState.leaningDuration > 8) {
        triggerAlert("Please sit up straight to maintain focus.", true);
      }
    }
  } else {
    appState.leaningStartTime = null;
    appState.leaningDuration = 0;
  }

  // Check for looking down
  const lookingDownProbability = getProbabilityForClass(prediction, "looking down");
  if (lookingDownProbability > 0.7) {
    if (!appState.recentLookDown || currentTime - appState.recentLookDown > 8000) {
      triggerAlert("Keep your head up and stay focused!", true);
      appState.recentLookDown = currentTime;
    }
  }

  // Check for leaning on hand
  const leaningOnHandProbability = getProbabilityForClass(prediction, "leaning on hand");
  if (leaningOnHandProbability > 0.7) {
    if (!appState.recentLeanHand || currentTime - appState.recentLeanHand > 8000) {
      triggerAlert("Please don't lean on your hand. Sit up straight!", true);
      appState.recentLeanHand = currentTime;
    }
  }

  const lookingAwayProbability = getProbabilityForClass(prediction, "looking away");
  if (lookingAwayProbability > 0.7) {
    if (!appState.recentLookAway || currentTime - appState.recentLookAway > 5000) {
      appState.lookingAwayCount++;
      appState.recentLookAway = currentTime;
      if (appState.lookingAwayCount % 3 === 0) {
        appState.alertLevel = Math.min(appState.alertLevel + 1, 3);
        triggerAdaptiveAlert();
      }
    }
  }

  // Check for raised hand with 90% confidence threshold
  const raisedHandProbability = getProbabilityForClass(prediction, "raise hand");
  
  if (raisedHandProbability > 0.9) {
    if (appState.raisedHandStartTime === null) {
      appState.raisedHandStartTime = currentTime;
    } else if (currentTime - appState.raisedHandStartTime > 1000) {
      gestureInfoEl.style.display = "block";
    }
  } else {
    appState.raisedHandStartTime = null;
    gestureInfoEl.style.display = "none";
  }

  leaningTimeEl.textContent = appState.leaningDuration + "s";
  lookingAwayCountEl.textContent = appState.lookingAwayCount;
}

function updateFocusScore(prediction) {
  const now = Date.now();
  if (now - appState.lastFocusCheck < 500) return;
  appState.lastFocusCheck = now;

  const topClass = getTopClass(prediction);
  const label = topClass.className.toLowerCase();
  const safeLabels = ["focused", "raise hand", "raised hand", "default"];
  const isSafe = safeLabels.some(safe => label.includes(safe));

  if (label !== appState.lastLabel) {
    appState.stabilityCounter = 0;
  } else {
    appState.stabilityCounter++;
  }
  appState.lastLabel = label;

  const isStable = appState.stabilityCounter >= 2;

  if (isStable && (label.includes("focused") || label.includes("default") || label.includes("raise hand") || label.includes("raised hand"))) {
    appState.consecutiveFocusedFrames++;
    if (appState.consecutiveFocusedFrames >= 3) {
      appState.focusScore = Math.min(appState.focusScore + 2, 100);
      appState.consecutiveFocusedFrames = 0;
    }
  } else if (isStable && !isSafe) {
    appState.consecutiveDistractedFrames++;
    if (appState.consecutiveDistractedFrames >= 5) {
      appState.focusScore = Math.max(appState.focusScore - 3, 0);
      appState.consecutiveDistractedFrames = 0;
    }
  }

  focusScoreEl.textContent = appState.focusScore;
  progressFillEl.style.width = `${appState.focusScore}%`;
}

function updateFocusTracking() {
  if (appState.isCalibrating) return;
  const currentTime = Date.now();
  if (appState.sessionStartTime) {
    appState.focusStreak = Math.floor((currentTime - appState.sessionStartTime) / 60000);
    focusStreakEl.textContent = appState.focusStreak;
  }
}

function getProbabilityForClass(prediction, className) {
  for (let i = 0; i < prediction.length; i++) {
    if (prediction[i].className.toLowerCase().includes(className.toLowerCase())) {
      return prediction[i].probability;
    }
  }
  return 0;
}

function getTopClass(prediction) {
  return prediction.reduce((a, b) => a.probability > b.probability ? a : b);
}

function triggerAdaptiveAlert() {
  console.log("🚨 triggerAdaptiveAlert() - alertLevel:", appState.alertLevel);
  
  const messages = [
    "Gentle reminder: Try to maintain focus on your studies.",
    "You're getting distracted frequently. Let's refocus.",
    "Important: Your focus is dropping significantly. Consider taking a short break."
  ];
  alertBoxEl.textContent = messages[Math.min(appState.alertLevel - 1, messages.length - 1)];
  alertBoxEl.style.display = "block";
  alertBoxEl.className = "alert-box";
  if (appState.alertLevel >= 2) alertBoxEl.classList.add("warning");
  if (appState.alertLevel >= 3) alertBoxEl.classList.add("alert");
  
  if (appState.alertLevel >= 2) {
    playAud();
  }
  
  setTimeout(() => { 
    alertBoxEl.style.display = "none";
    pauseAud();
  }, 5000);
}

function drawPose(pose) {
  if (webcam.canvas) {
    ctx.drawImage(webcam.canvas, 0, 0);
    if (pose) {
      const minPartConfidence = 0.5;
      tmPose.drawKeypoints(pose.keypoints, minPartConfidence, ctx);
      tmPose.drawSkeleton(pose.keypoints, minPartConfidence, ctx);
    }
  }
}

function triggerAlert(message, playSound = false) {
  console.log("🚨 triggerAlert():", message, "playSound:", playSound);
  
  alertBoxEl.textContent = message;
  alertBoxEl.style.display = "block";
  alertBoxEl.className = "alert-box warning";
  
  if (playSound) {
    playAud();
  }
  
  setTimeout(() => { 
    alertBoxEl.style.display = "none";
    if (playSound) {
      pauseAud();
    }
  }, 3000);
}