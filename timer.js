// One local rest timer; never included in the calculator's synced settings.
let restDeadline = null;
let restTick = null;
let restGeneration = 0;
let restAudio = null;
let restTones = [];
let restAlarmScheduled = false;
let restSoundAvailable = true;

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
  if (seconds !== 60 && seconds !== 180) return;
  const generation = ++restGeneration;
  clearTimeout(restTick);
  stopRestAlarm();
  restDeadline = Date.now() + seconds * 1000;
  restSoundAvailable = true;
  document.getElementById('timer-cancel').hidden = false;
  for (const duration of [60, 180]) {
    document.getElementById('timer-' + duration).setAttribute('aria-pressed', String(duration === seconds));
  }
  document.getElementById('timer-status').textContent = (seconds / 60) + '-minute timer started. Press either button to restart.';
  updateRestTimer();
  try {
    // Create/resume during the button gesture to satisfy browser audio rules.
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio unavailable');
    if (!restAudio || restAudio.state === 'closed') restAudio = new Audio();
    await restAudio.resume();
    if (generation !== restGeneration || restDeadline === null) return;
    if (restAudio.state !== 'running') throw new Error('Audio suspended');
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
    for (const duration of [60, 180]) document.getElementById('timer-' + duration).setAttribute('aria-pressed', 'false');
    document.getElementById('timer-cancel').hidden = true;
    document.getElementById('timer-status').textContent = restSoundAvailable
      ? 'Time is up! Ready for your next set.' : 'Time is up! Sound was unavailable.';
    if (!restAlarmScheduled && restAudio?.state === 'running') scheduleRestAlarm(0);
    return;
  }
  restTick = setTimeout(updateRestTimer, 250);
}

function cancelRestTimer() {
  ++restGeneration;
  clearTimeout(restTick);
  restDeadline = null;
  stopRestAlarm();
  document.getElementById('timer-display').textContent = '0:00';
  document.getElementById('timer-status').textContent = 'Timer cancelled. Choose a timer to start again.';
  for (const duration of [60, 180]) document.getElementById('timer-' + duration).setAttribute('aria-pressed', 'false');
  const cancel = document.getElementById('timer-cancel');
  if (document.activeElement === cancel) document.getElementById('timer-60').focus();
  cancel.hidden = true;
}

document.addEventListener('visibilitychange', updateRestTimer);
window.addEventListener('pageshow', updateRestTimer);
