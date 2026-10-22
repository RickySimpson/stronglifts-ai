const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function timer({audio=true,resume,wakeLock}={}) {
  let now=0,id=0;
  const elements=new Map(),jobs=new Map(),tones=[];
  const el=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',hidden:true,setAttribute(k,v){this[k]=v;},focus(){}});
    return elements.get(id);
  };
  class Audio {
    state='running';destination={};
    get currentTime(){return 10+now/1000;}
    resume(){return resume?resume():Promise.resolve();}
    createOscillator(){const tone={frequency:{},connect(){},disconnect(){},start(at){this.at=at;},stop(at){this.stopAt=at;}};tones.push(tone);return tone;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const ctx=vm.createContext({Date:{now:()=>now},navigator:{wakeLock},window:{AudioContext:audio?Audio:undefined,addEventListener(){}},document:{visibilityState:'visible',getElementById:el,addEventListener(){}},setTimeout:fn=>{jobs.set(++id,fn);return id;},clearTimeout:id=>jobs.delete(id)});
  const run=code=>vm.runInContext(code,ctx);
  run(fs.readFileSync('timer.js','utf8'));
  return {run,el,tones,jobs,advance(ms){now+=ms;run('updateRestTimer()');}};
}

test('one-minute timer schedules six alarm beeps and completes once',async()=>{
  const t=timer();await t.run('startRestTimer(60)');
  assert.equal(t.el('timer-display').textContent,'1:00');
  assert.equal(t.tones.length,6);assert.equal(t.tones[0].at,70);
  t.advance(59000);assert.equal(t.el('timer-display').textContent,'0:01');
  t.advance(1000);assert.equal(t.el('timer-display').textContent,'0:00');
  assert.match(t.el('timer-status').textContent,/Time is up/);
  assert.equal(t.jobs.size,0);t.advance(3000);assert.equal(t.tones.length,6);
});

test('three-minute timer uses elapsed time even after a delayed tick',async()=>{
  const t=timer();await t.run('startRestTimer(180)');
  assert.equal(t.el('timer-display').textContent,'3:00');
  assert.equal(t.tones[0].at,190);
  t.advance(93000);assert.equal(t.el('timer-display').textContent,'1:27');
  t.advance(100000);assert.equal(t.el('timer-display').textContent,'0:00');
});

test('restart and cancel remove the previous alarm',async()=>{
  const t=timer();await t.run('startRestTimer(60)');
  const old=t.tones.slice();await t.run('startRestTimer(180)');
  assert.ok(old.every(t=>t.stopAt===undefined));
  assert.equal(t.el('timer-60')['aria-pressed'],'false');
  assert.equal(t.el('timer-180')['aria-pressed'],'true');
  t.run('cancelRestTimer()');assert.equal(t.jobs.size,0);
  assert.ok(t.tones.every(t=>t.stopAt===undefined));
  t.advance(200000);assert.match(t.el('timer-status').textContent,/cancelled/);
});

test('unavailable audio still provides countdown and completion feedback',async()=>{
  const t=timer({audio:false});await t.run('startRestTimer(60)');
  assert.match(t.el('timer-status').textContent,/without sound/);
  t.advance(60000);assert.match(t.el('timer-status').textContent,/Time is up! Sound was unavailable/);
});

test('late audio initialization cannot resurrect a cancelled timer',async()=>{
  let resolve;const t=timer({resume:()=>new Promise(r=>resolve=r)});
  const start=t.run('startRestTimer(60)');t.run('cancelRestTimer()');resolve();await start;
  assert.equal(t.tones.length,0);assert.equal(t.jobs.size,0);
});

test('five-minute timer schedules an alarm at 300 seconds',async()=>{
  const t=timer();await t.run('startRestTimer(300)');
  assert.equal(t.el('timer-display').textContent,'5:00');
  assert.equal(t.el('timer-300')['aria-pressed'],'true');
  assert.equal(t.tones[0].at,310);
  t.advance(299000);assert.equal(t.el('timer-display').textContent,'0:01');
  t.advance(1000);assert.equal(t.el('timer-display').textContent,'0:00');
});

const flush=()=>new Promise(r=>setImmediate(r));
test('screen wake is held while running and released on finish or cancel',async()=>{
  let released=0,requested=0;
  const t=timer({wakeLock:{request:async type=>{assert.equal(type,'screen');requested++;return {release:async()=>released++,addEventListener(){}};}}});
  await t.run('startRestTimer(60)');assert.equal(requested,1);
  assert.match(t.el('timer-screen').textContent,/Keeping your screen awake/);
  t.advance(60000);assert.equal(released,1);
  await t.run('startRestTimer(300)');t.run('cancelRestTimer()');assert.equal(released,2);
});

test('screen wake rejection does not stop countdown or audio',async()=>{
  const t=timer({wakeLock:{request:async()=>{throw Error('denied');}}});
  await t.run('startRestTimer(300)');assert.equal(t.el('timer-display').textContent,'5:00');
  assert.match(t.el('timer-screen').textContent,/Could not keep/);assert.equal(t.tones.length,6);
});

test('late wake grant is released after cancellation',async()=>{
  let grant,released=0;
  const t=timer({wakeLock:{request:()=>new Promise(r=>grant=r)}});
  await t.run('startRestTimer(60)');t.run('cancelRestTimer()');
  grant({release:async()=>released++,addEventListener(){}});await flush();assert.equal(released,1);
});

test('suspended audio clock is rescheduled immediately when timer expires',async()=>{
  const t=timer();await t.run('startRestTimer(60)');
  t.run("Object.defineProperty(restAudio,'currentTime',{value:12})");
  t.advance(60000);await flush();
  assert.equal(t.tones.length,12);assert.equal(t.tones[6].at,12);
  t.advance(1000);await flush();assert.equal(t.tones.length,12);
});

test('sound test keeps the countdown and future alarm intact',async()=>{
  const t=timer();await t.run('startRestTimer(300)');t.advance(30000);
  await t.run('testRestSound()');assert.equal(t.el('timer-display').textContent,'4:30');
  assert.equal(t.tones.at(-6).at,310);
});

test('returning to a visible page reacquires a released wake lock',async()=>{
  let requested=0,releaseEvent;
  const t=timer({wakeLock:{request:async()=>{requested++;return {release:async()=>{},addEventListener:(_,cb)=>releaseEvent=cb};}}});
  await t.run('startRestTimer(60)');
  t.run("document.visibilityState='hidden'");releaseEvent();
  t.run('restoreRestTimer()');assert.equal(requested,1);
  t.run("document.visibilityState='visible';restoreRestTimer()");await flush();
  assert.equal(requested,2);assert.match(t.el('timer-screen').textContent,/Keeping/);
});

test('blocked audio recovery gives a clear completion message',async()=>{
  let blocked=false;
  const t=timer({resume:()=>blocked?Promise.reject(Error('blocked')):Promise.resolve()});
  await t.run('startRestTimer(60)');blocked=true;
  t.run("restAudio.state='interrupted'");t.advance(60000);await flush();
  assert.match(t.el('timer-status').textContent,/Time is up! Sound is blocked/);
  blocked=false;t.run("restAudio.state='running';restoreRestTimer()");await flush();
  assert.match(t.el('timer-status').textContent,/Ready for your next set/);
  assert.equal(t.tones.length,12);
});
