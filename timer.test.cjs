const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function timer({audio=true,resume}={}) {
  let now=0,id=0;
  const elements=new Map(),jobs=new Map(),tones=[];
  const el=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',hidden:true,setAttribute(k,v){this[k]=v;},focus(){}});
    return elements.get(id);
  };
  class Audio {
    state='running';currentTime=10;destination={};
    resume(){return resume?resume():Promise.resolve();}
    createOscillator(){const tone={frequency:{},connect(){},disconnect(){},start(at){this.at=at;},stop(at){this.stopAt=at;}};tones.push(tone);return tone;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const ctx=vm.createContext({Date:{now:()=>now},window:{AudioContext:audio?Audio:undefined,addEventListener(){}},document:{getElementById:el,addEventListener(){}},setTimeout:fn=>{jobs.set(++id,fn);return id;},clearTimeout:id=>jobs.delete(id)});
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
