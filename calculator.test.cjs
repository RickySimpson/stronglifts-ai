const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1].split('const hasCache=restoreCache();')[0];

function app({storage=new Map(), search='', blocked=false, fetch=async()=>{throw Error('offline');}}={}) {
  const elements=new Map(), timers=new Map();let timerId=0;
  const el=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,classList:{toggle(){}},contains:()=>false,setAttribute(){},addEventListener(){},focus(){}});
    return elements.get(id);
  };
  const context=vm.createContext({URLSearchParams,AbortController,crypto:require('node:crypto').webcrypto,
    location:{search},navigator:{},document:{getElementById:el},fetch,
    localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k)??null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v);}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),confirm:()=>true});
  const run=code=>vm.runInContext(code,context);
  run(source);
  return {run,el,storage,timers};
}
const response=data=>({ok:true,status:200,json:async()=>({data})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('fractional targets return the adjacent available loads',()=>{
  const a=app();
  for(const target of [136,137.5,139.99]){
    const result=a.run(`solve(${target})`);
    assert.equal(result.exact,false);assert.equal(result.lower.total,135);assert.equal(result.upper.total,140);
  }
  assert.equal(a.run('solve(140).total'),140);
  assert.equal(a.run('solve(405).lower.total'),290);
  assert.equal(a.run('solve(405).upper'),null);
  a.run('state.inventory.lbs=[0,0,0,0,0,0];state.target.lbs=45;renderResult()');
  assert.match(a.el('result').innerHTML,/Bar only/);
});

test('metric equipment uses kilogram values and symmetric 1.25 kg plates',()=>{
  const a=app();a.run("setUnit('kg')");
  assert.equal(a.run('state.barWeight.kg'),20);
  assert.equal(a.run('solve(60).plates[0].size'),20);
  assert.equal(a.run('solve(60).total'),60);
  assert.equal(a.run('step()'),2.5);
  assert.equal(a.run('solve(61).lower.total'),60);
  assert.equal(a.run('solve(61).upper.total'),62.5);
  assert.equal(a.run('solve(62.5).plates.find(p=>p.size===1.25).count'),1);
  assert.equal(a.run('solve(140).lower.total'),127.5);
  a.run('state.inventory.kg=[0,0,0,0,0,0];state.target.kg=20;renderResult()');
  assert.match(a.el('result').innerHTML,/Bar only/);
});

test('a 45 lb bar entered as 20.41 kg retains its weight with metric plates',()=>{
  const a=app();a.run("setUnit('kg')");
  a.el('bar-weight').value=(45*0.45359237).toFixed(2);
  a.run('commitBar()');
  assert.equal(a.run('state.barWeight.kg'),20.41);
  assert.equal(a.el('bar-unit').textContent,'(kg)');
  assert.equal(a.run('solve(60.41).exact'),true);
  assert.equal(a.run('solve(60.41).plates[0].size'),20);
  assert.equal(a.run('solve(60).lower.total'),57.91);
  assert.equal(a.run('solve(60).upper.total'),60.41);
  a.run("setTarget(60.41);setUnit('lbs')");
  assert.equal(a.run('state.barWeight.lbs'),45);
  assert.equal(a.run('state.target.lbs'),135);
  a.run("setUnit('kg')");
  assert.equal(a.run('state.barWeight.kg'),20.41);
  assert.equal(a.run('state.target.kg'),60.41);
});

test('solver matches independently enumerated loads for both units and sparse inventories',()=>{
  const a=app();
  for(const u of ['lbs','kg']) for(const inv of [[0,0,0,0,0,0],[1,1,1,1,1,1],[2,0,1,0,0,0],[0,1,0,2,1,0]]){
    a.run(`state.units='${u}';state.inventory.${u}=${JSON.stringify(inv)};state.barWeight.${u}=17.3`);
    const sizes=JSON.parse(a.run('JSON.stringify(sizes())'));
    let totals=[17.3];
    sizes.forEach((size,i)=>{totals=totals.flatMap(v=>Array.from({length:inv[i]+1},(_,n)=>Math.round((v+2*n*size)*100)/100));});
    totals=[...new Set(totals)].sort((a,b)=>a-b);
    for(let t=17.3;t<=totals.at(-1)+10;t+=1.25){
      const target=Math.round(t*100)/100,result=a.run(`solve(${target})`);
      if(totals.includes(target)) assert.equal(result.total,target);
      else {assert.equal(result.lower?.total,totals.filter(v=>v<target).at(-1));assert.equal(result.upper?.total,totals.find(v=>v>target));}
      for(const load of result.exact?[result]:[result.lower,result.upper].filter(Boolean)){
        assert.equal(Math.round((17.3+2*load.plates.reduce((s,p)=>s+p.size*p.count,0))*100)/100,load.total);
        load.plates.forEach(p=>assert.ok(p.count<=inv[sizes.indexOf(p.size)]));
      }
    }
  }
});

test('bad data and inaccessible storage do not break the calculator',()=>{
  const a=app({blocked:true});
  a.run('restoreCache();normalizeLoaded({calculator:{inventory:{lbs:4,kg:4},barWeight:{lbs:-5},target:{lbs:-10}}});renderAll();queueSave()');
  assert.equal(a.run('state.barWeight.lbs'),45);
  assert.equal(a.run('state.target.lbs'),135);
  a.run('normalizeLoaded({calculator:{inventory:{lbs:[-1,Infinity,2.9],kg:[]}}})');
  assert.equal(a.run('JSON.stringify(state.inventory.lbs)'),'[0,0,2,0,0,0]');
  const b=app({storage:new Map([['sl_user_key','x'],['sl_calc_cache:x','bad json']])});
  assert.equal(b.run('restoreCache()'),false);
});

test('input normalization explains adjustments and presets respect equipment',()=>{
  const a=app();
  a.run('setTarget(0)');assert.equal(a.run('state.target.lbs'),45);
  assert.match(a.el('input-message').textContent,/adjusted/);
  a.run('setTarget(Infinity)');assert.equal(a.run('state.target.lbs'),45);
  assert.match(a.el('input-message').textContent,/Enter a target/);
  a.run('renderTarget()');assert.doesNotMatch(a.el('quick-targets').innerHTML,/315|405/);
  a.el('bar-weight').value='50';a.run('commitBar()');
  assert.equal(a.run('state.target.lbs'),50);
  a.run('state.barWeight.lbs=2;changeBar(-1)');assert.equal(a.run('state.barWeight.lbs'),0.01);
});

test('cache is scoped to the selected user and writes immediately',()=>{
  const storage=new Map([['sl_calc_cache:other',JSON.stringify({data:{calculator:{target:{lbs:225}}},pending:true})]]);
  const a=app({search:'?uid=current',storage});
  assert.equal(a.run('restoreCache()'),false);
  a.run('setTarget(185)');
  assert.equal(JSON.parse(storage.get('sl_calc_cache:current')).data.calculator.target.lbs,185);
  assert.equal(JSON.parse(storage.get('sl_calc_cache:current')).pending,true);
});

test('legacy cache migration preserves newer edits and never crosses user IDs',async()=>{
  const legacy={updatedAt:200,calculator:{target:{lbs:225}}};
  const storage=new Map([['sl_user_key','original'],['sl_calc_cache',JSON.stringify(legacy)]]);
  const posts=[];
  const a=app({storage,fetch:async(_,opts)=>{if(opts.method){posts.push(JSON.parse(opts.body));return response({});}return response({updatedAt:100,calculator:{target:{lbs:95}}});}});
  assert.equal(a.run('restoreCache()'),true);await a.run('load()');
  assert.equal(posts[0].calculator.target.lbs,225);
  const b=app({storage,search:'?uid=different'});
  assert.equal(b.run('restoreCache()'),false);assert.equal(b.run('state.target.lbs'),135);
});

test('edits during startup survive a stale remote response',async()=>{
  let resolveGet;const posts=[];
  const a=app({fetch:(_,opts)=>opts.method?(posts.push(JSON.parse(opts.body)),Promise.resolve(response({}))):new Promise(r=>resolveGet=r)});
  const loading=a.run('load()');
  a.run('setTarget(185)');
  resolveGet(response({notes:'preserve me',calculator:{target:{lbs:95}}}));
  await loading;
  assert.equal(a.run('state.target.lbs'),185);assert.equal(posts[0].calculator.target.lbs,185);
  assert.equal(posts[0].notes,'preserve me');assert.equal(a.run('pending'),false);
});

test('saves are serialized and the latest edit is acknowledged last',async()=>{
  const requests=[];
  const a=app({fetch:(_,opts)=>new Promise(resolve=>requests.push({resolve,payload:JSON.parse(opts.body)}))});
  a.run('setTarget(185)');const saving=a.run('saveNow()');
  a.run('setTarget(225)');await a.run('saveNow()');assert.equal(requests.length,1);
  requests[0].resolve(response({}));await tick();
  assert.equal(requests.length,2);assert.equal(requests[1].payload.calculator.target.lbs,225);
  assert.equal(a.run('pending'),true);
  requests[1].resolve(response({}));await saving;
  assert.equal(a.run('pending'),false);assert.equal(a.el('sync-label').textContent,'Saved');
});

test('failed saves survive reload and retry without losing edits',async()=>{
  const storage=new Map([['sl_user_key','x']]);const a=app({storage});
  a.run('setTarget(225)');await a.run('saveNow()');
  assert.equal(a.run('pending'),true);assert.match(a.el('sync-label').textContent,/Saved on this device/);
  const posts=[];
  const b=app({storage,fetch:async(_,opts)=>{if(opts.method){posts.push(JSON.parse(opts.body));return response({});}return response({calculator:{target:{lbs:95}}});}});
  assert.equal(b.run('restoreCache()'),true);await b.run('load()');
  assert.equal(posts[0].calculator.target.lbs,225);assert.equal(b.run('pending'),false);
});

test('timeout aborts a hung request and offers retry',async()=>{
  const a=app({fetch:(_,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('timeout'))))});
  const loading=a.run('load()');
  [...a.timers.values()].find(t=>t.ms===8000).fn();await loading;
  assert.equal(a.el('sync-retry').hidden,false);assert.equal(a.run('loading'),false);
});
