const assert = require('node:assert/strict');
const { buildRequest, signature, display, create } = require('../app/remote-calculations.js');
const { defaults } = require('../app/lens-presets.js');
const constants = require('../formulas/iol-constants.js');
const context = { caseKey: 'one', blockers: [], history: 'none', lens: {maker:'Alcon',model:'SN60WF',alSource:'optical'}, biometer:'Other', data: { eye: 'OD', caseCode: 'PRIVATE', lensName: 'Alcon SN60WF', A:119, gender: 'F', kIndex: 1.3375, AL: 24, K1: 43, K2: 44, ACD: 3.2, LT:4.5, target:0, fileName:'private.pdf' } };
const change = (remote, field, value, provider) => remote.change({dataset:{remote:field,provider},value,checked:value});
const ok = (body={}) => ({ok:true,json:async()=>({status:'ok',rows:[{power:20,refraction:-.23}],constant:119,model:'Other',queriedAt:1,...body})});
const tick = () => new Promise(resolve=>setImmediate(resolve));
const memoryStorage = () => {const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),all:()=>JSON.stringify([...data.values()])};};
const request=buildRequest('cooke',context,{constant:119,model:'Other'},'Other');
assert.equal(request.measurements.AL,24);
assert.ok(!JSON.stringify(request).includes('PRIVATE'));
assert.ok(!JSON.stringify(request).includes('private.pdf'));
assert.ok(!JSON.stringify(request).includes('lensName'));
assert.notEqual(signature(context,request),signature({...context,caseKey:'two'},request));
assert.notEqual(signature(context,request),signature({...context,lens:{maker:'AMO',model:'AAB00'}},request));
assert.equal(display(-.215),'-0.22');assert.equal(display(.122),'+0.12');assert.equal(display(null),'—');
assert.equal(defaults(context.lens).cooke.constant,118.9648);
assert.equal(defaults(context.lens).hoffer.constant,5.67);
assert.equal(defaults({maker:'AMO',model:'AAB00'}).hoffer.constant,5.56);
assert.equal(defaults({maker:'AMO',model:'ICB00'}).pearl.constant,null); // ICB00 must not be mistaken for PCB00.
assert.equal(defaults({maker:'AMO',model:'ICB00'}).evo.model,'Eyhance');
assert.equal(defaults({maker:'Zeiss',model:'LARA'}).hoffer.constant,null); // Incomplete name cannot choose 829 vs 929.
assert.equal(defaults({maker:'Unknown',model:'SN60WF'}).pearl.constant,null); // Match manufacturer too.
for(const model of ['SN60WF','ZCB00','SA60AT'])assert.equal(constants.filter(x=>x.model===model).length,1);
(async()=>{
 const oldFetch=global.fetch;
 let active=context, requests=[], pending=[];
 global.fetch=async(url,options)=>{
  if(url==='/api/config')return {ok:true,json:async()=>({remoteCalculations:true})};
  const body=JSON.parse(options.body);requests.push(body);
  return ok({constant:body.settings.constant,model:body.settings.model});
 };
 try{
  const storage=memoryStorage(),remote=create(()=>active,()=>{},storage);await tick();
  assert.ok(remote.render(active).includes('118.9648'));
  change(remote,'consent',true);
  await remote.query('all');
  assert.equal(requests.length,4);
  assert.deepEqual(requests.map(x=>x.settings),[{constant:118.9648,model:'Other'},{constant:5.67,model:'Default'},{constant:119.1,model:'SN60WF'},{constant:119,model:'SN60WF'}]);
  assert.ok(requests.every(x=>x.measurements.biometer==='Other'));
  assert.ok(remote.render(active).includes('-0.23'));
  // A new lens must clear results and all unsaved overrides, even when its constants are incomplete.
  change(remote,'constant','120.1234','cooke');
  active={...context,lens:{maker:'AMO',model:'AAB00',alSource:'optical'},data:{...context.data,lensName:'AMO AAB00'}};
  const html=remote.render(active);assert.ok(html.includes('118.9942'));assert.ok(html.includes('5.56'));assert.ok(!html.includes('120.1234'));assert.ok(!html.includes('作者網站回傳的標準 SE 預測（D）'));
  requests=[];await remote.query('all');assert.deepEqual(requests.map(x=>x.formula),['cooke','hoffer']);
  remote.action('use-upper','hoffer'); // pACD must never receive an A constant.
  remote.action('use-upper','pearl');remote.action('use-upper','evo');
  requests=[];await remote.query('all');assert.equal(requests.length,4);assert.equal(requests[1].settings.constant,5.56);assert.equal(requests[2].settings.constant,119);
  active={...active,data:{...active.data,A:119.2}};remote.render(active);requests=[];await remote.query('pearl');assert.equal(requests[0].settings.constant,119.2);
  // Explicit memory stores only valid formula settings, scoped by exact lens.
  remote.action('save');const stored=storage.all();assert.ok(!stored.includes('PRIVATE'));assert.ok(!stored.includes('private.pdf'));assert.ok(!stored.includes('measurements'));assert.ok(!stored.includes('gender'));assert.ok(!stored.includes('caseKey'));
  active=context;remote.render(active);requests=[];await remote.query('cooke');assert.equal(requests[0].settings.constant,118.9648);
  active={...context,lens:{maker:'AMO',model:'AAB00',alSource:'optical'},data:{...context.data,lensName:'AMO AAB00'}};remote.render(active);
  requests=[];await remote.query('pearl');assert.equal(requests[0].settings.constant,119.2);
  remote.action('restore');requests=[];await remote.query('pearl');assert.equal(requests.length,0);
  remote.action('forget');
  // New patient resets consent, and a different eye-axis instrument replaces the old instrument.
  active={...context,caseKey:'new',biometer:'Lenstar'};remote.render(active);requests=[];await remote.query('all');assert.equal(requests.length,0);
  change(remote,'consent',true);await remote.query('cooke');assert.equal(requests[0].measurements.biometer,'Lenstar');
  // A model edit clears its previous model's constant. Precision is preserved on manual entry.
  change(remote,'model','AlconMA60MA','cooke');requests=[];await remote.query('cooke');assert.equal(requests.length,0);
  change(remote,'constant','118.9123','cooke');await remote.query('cooke');assert.equal(requests[0].settings.constant,118.9123);
  // An older query cannot replace a newer query after changing lens, even if fetch ignores abort.
  global.fetch=async(url,options)=> url==='/api/config'?{ok:true,json:async()=>({remoteCalculations:true})}:new Promise(resolve=>pending.push({resolve,body:JSON.parse(options.body)}));
  active=context;remote.render(active);change(remote,'consent',true);const old=remote.query('cooke');
  active={...context,lens:{maker:'AMO',model:'ZCB00',alSource:'optical'},data:{...context.data,lensName:'AMO ZCB00'}};remote.render(active);
  const newer=remote.query('cooke');assert.equal(pending.length,2);
  pending[0].resolve(ok({rows:[{power:20,refraction:9.99}]}));await old;
  assert.ok(remote.render(active).includes('查詢中…'));assert.ok(!remote.render(active).includes('9.99'));
  pending[1].resolve(ok({rows:[{power:20,refraction:-.45}]}));await newer;assert.ok(remote.render(active).includes('-0.45'));
  // Changing a constant away and back must invalidate a still-pending response.
  pending=[];const stale=remote.query('cooke');change(remote,'constant','120','cooke');change(remote,'constant','119.4303','cooke');pending[0].resolve(ok({rows:[{power:20,refraction:8.88}]}));await stale;assert.ok(!remote.render(active).includes('8.88'));
  global.fetch=async()=>({ok:false});const staticRemote=create(()=>context,()=>{},null);assert.equal(staticRemote.render(context),'');await tick();assert.equal(staticRemote.render(context),'');
  global.fetch=async()=>({ok:true,json:async()=>({remoteCalculations:true})});
  const broken=create(()=>context,()=>{}, {getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});await tick();assert.ok(broken.render(context).includes('118.9648'));broken.action('save');assert.ok(broken.render(context).includes('無法儲存設定'));
  console.log('Remote tests passed: exact defaults, no pACD conversion, lens/instrument changes, explicit private settings memory, overrides, abort/races, storage failure, static hiding.');
 }finally{global.fetch=oldFetch;}
})().catch(e=>{console.error(e);process.exitCode=1;});
