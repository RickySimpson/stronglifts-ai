// One local rest timer; never included in the calculator's synced settings.
let restDeadline = null;
let restTick = null;
let restGeneration = 0;
let restAudio = null;
let restTones = [];
let restAlarmScheduled = false;
let restSoundAvailable = true;
const REST_DURATIONS = [60, 180, 300];
let restWakeLock = null;
let restWakeRequest = null;
let restAlarmAt = null;
let restAwaitingAlarm = false;
let restRecovering = false;

function releaseRestScreen() {
  const lock = restWakeLock;
  restWakeLock = null;
  if (lock) lock.release().catch(() => {});
  document.getElementById('timer-screen').textContent = 'The timer will try to keep your screen awake.';
}

async function keepRestScreenAwake() {
  if (restDeadline === null || document.visibilityState === 'hidden' || restWakeLock || restWakeRequest) return;
  if (!navigator.wakeLock) {
    document.getElementById('timer-screen').textContent = 'Automatic screen wake is unavailable. Keep your screen on for the alarm.';
    return;
  }
  const generation = restGeneration;
  let request;
  try {
    request = navigator.wakeLock.request('screen');
    restWakeRequest = request;
    const lock = await request;
    if (generation !== restGeneration || restDeadline === null || document.visibilityState === 'hidden') {
      await lock.release();
      return;
    }
    restWakeLock = lock;
    document.getElementById('timer-screen').textContent = 'Keeping your screen awake until the timer ends.';
    lock.addEventListener('release', () => {
      if (restWakeLock !== lock) return;
      restWakeLock = null;
      if (restDeadline !== null) document.getElementById('timer-screen').textContent = 'Screen wake was released. Keep your screen on for the alarm.';
    });
  } catch {
    if (generation === restGeneration && restDeadline !== null) document.getElementById('timer-screen').textContent = 'Could not keep the screen awake. Keep your screen on for the alarm.';
  } finally {
    if (restWakeRequest === request) restWakeRequest = null;
    if (generation !== restGeneration && restDeadline !== null) void keepRestScreenAwake();
  }
}

async function readyRestAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error('Audio unavailable');
  if (!restAudio || restAudio.state === 'closed') restAudio = new Audio();
  let timeout;
  try {
    await Promise.race([restAudio.resume(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Audio blocked')), 2000);
    })]);
    if (restAudio.state !== 'running') throw new Error('Audio suspended');
  } finally { clearTimeout(timeout); }
}

function stopRestAlarm() {
  for (const tone of restTones) {
    try { tone.stop(); } catch {}
    tone.disconnect();
  }
  restTones = [];
  restAlarmScheduled = false;
}

function scheduleRestAlarm(delay) {
  const start = restAudio.currentTime + Math.max(0, delay);
  restAlarmAt = start;
  // Schedule in the audio clock so ordinary background-tab timer throttling
  // doesn't postpone the sound. Device/browser suspension can still delay it.
  for (let i = 0; i < 6; i++) {
    const tone = restAudio.createOscillator();
    const gain = restAudio.createGain();
    const at = start + i * 0.4;
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.015);
    gain.gain.setValueAtTime(0.18, at + 0.2);
    gain.gain.linearRampToValueAtTime(0, at + 0.25);
    tone.connect(gain);
    gain.connect(restAudio.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    restTones.push(tone);
    tone.start(at);
    tone.stop(at + 0.26);
  }
  restAlarmScheduled = true;
}

async function startRestTimer(seconds) {
  if (!REST_DURATIONS.includes(seconds)) return;
  const generation = ++restGeneration;
  clearTimeout(restTick);
  stopRestAlarm();
  restDeadline = Date.now() + seconds * 1000;
  restSoundAvailable = true;
  restAwaitingAlarm = false;
  releaseRestScreen();
  void keepRestScreenAwake();
  document.getElementById('timer-cancel').hidden = false;
  for (const duration of REST_DURATIONS) {
    document.getElementById('timer-' + duration).setAttribute('aria-pressed', String(duration === seconds));
  }
  document.getElementById('timer-status').textContent = (seconds / 60) + '-minute timer started. Press a duration to restart.';
  updateRestTimer();
  try {
    // Create/resume during the button gesture to satisfy browser audio rules.
    await readyRestAudio();
    if (generation !== restGeneration || restDeadline === null) return;
    if (restAudio.state !== 'running') throw new Error('Audio suspended');
    stopRestAlarm();
    scheduleRestAlarm((restDeadline - Date.now()) / 1000);
  } catch {
    if (generation !== restGeneration) return;
    stopRestAlarm();
    restSoundAvailable = false;
    document.getElementById('timer-status').textContent = restDeadline === null
      ? 'Time is up! Sound was unavailable.'
      : 'Timer running without sound. Your browser could not enable the alarm.';
  }
}

function updateRestTimer() {
  clearTimeout(restTick);
  if (restDeadline === null) return;
  const remaining = Math.max(0, Math.ceil((restDeadline - Date.now()) / 1000));
  document.getElementById('timer-display').textContent = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
  if (remaining === 0) {
    restDeadline = null;
    for (const duration of REST_DURATIONS) document.getElementById('timer-' + duration).setAttribute('aria-pressed', 'false');
    document.getElementById('timer-cancel').hidden = true;
    document.getElementById('timer-status').textContent = restSoundAvailable
      ? 'Time is up! Ready for your next set.' : 'Time is up! Sound was unavailable.';
    releaseRestScreen();
    // The audio clock may have paused while wall-clock time continued.
    if (!restAlarmScheduled || restAudio?.state !== 'running' || restAlarmAt > restAudio.currentTime + 0.3) {
      restAwaitingAlarm = true;
      void recoverRestAlarm();
    }
    return;
  }
  restTick = setTimeout(updateRestTimer, 250);
}

function cancelRestTimer() {
  ++restGeneration;
  clearTimeout(restTick);
  restDeadline = null;
  restAwaitingAlarm = false;
  releaseRestScreen();
  stopRestAlarm();
  document.getElementById('timer-display').textContent = '0:00';
  document.getElementById('timer-status').textContent = 'Timer cancelled. Choose a timer to start again.';
  for (const duration of REST_DURATIONS) document.getElementById('timer-' + duration).setAttribute('aria-pressed', 'false');
  const cancel = document.getElementById('timer-cancel');
  if (document.activeElement === cancel) document.getElementById('timer-60').focus();
  cancel.hidden = true;
}

async function recoverRestAlarm() {
  if (restRecovering || !restAwaitingAlarm) return;
  restRecovering = true;
  const generation = restGeneration;
  stopRestAlarm();
  try {
    await readyRestAudio();
    if (generation !== restGeneration || !restAwaitingAlarm) return;
    stopRestAlarm();
    scheduleRestAlarm(0);
    restAwaitingAlarm = false;
    document.getElementById('timer-status').textContent = 'Time is up! Ready for your next set.';
  } catch {
    if (generation === restGeneration) document.getElementById('timer-status').textContent = 'Time is up! Sound is blocked. Tap Test sound to enable it.';
  } finally { restRecovering = false; }
}

async function testRestSound() {
  const generation = restGeneration;
  try {
    await readyRestAudio();
    if (generation !== restGeneration) return;
    // Use a separate tone, leaving the countdown and its scheduled alarm intact.
    const tone = restAudio.createOscillator();
    const gain = restAudio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, restAudio.currentTime);
    gain.gain.linearRampToValueAtTime(0, restAudio.currentTime + 0.3);
    tone.connect(gain);gain.connect(restAudio.destination);
    tone.onended = () => { tone.disconnect();gain.disconnect(); };
    tone.start();tone.stop(restAudio.currentTime + 0.3);
    restSoundAvailable = true;
    if (restDeadline !== null) {stopRestAlarm();scheduleRestAlarm((restDeadline-Date.now())/1000);}
    else if (restAwaitingAlarm) void recoverRestAlarm();
    document.getElementById('timer-status').textContent = 'Test beep played. If you cannot hear it, check media volume and your audio output.';
  } catch {
    if (generation === restGeneration) document.getElementById('timer-status').textContent = 'Sound could not start. Check browser sound permissions and try again.';
  }
}

function restoreRestTimer() {
  updateRestTimer();
  if (document.visibilityState !== 'hidden') {
    void keepRestScreenAwake();
    if (restAwaitingAlarm) void recoverRestAlarm();
  }
}
document.addEventListener('visibilitychange', restoreRestTimer);
window.addEventListener('pageshow', restoreRestTimer);
