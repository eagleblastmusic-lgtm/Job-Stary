import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildStrategyReport } from '../domain/strategyEngine.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';
import { parseJobText } from '../domain/jobParser.js';

test('Strategy Engine stays inactive on small samples and only compares sufficiently sampled segments',()=>{
 const small=buildStrategyReport({applications:9,responses:2,interviews:1,offers:0,roles:[],contracts:[],fresh:null,older:null,radius:null,skill:null});assert.equal(small.activated,false);assert.equal(small.recommendations.length,0);
 const report=buildStrategyReport({applications:12,responses:6,interviews:3,offers:1,roles:[{label:'rola-a',sampleSize:6,progressed:5},{label:'rola-b',sampleSize:6,progressed:1}],contracts:[],fresh:{label:'≤7 dni',sampleSize:6,progressed:5},older:{label:'>7 dni',sampleSize:6,progressed:1},radius:null,skill:null});assert.equal(report.activated,true);assert.ok(report.recommendations.some(r=>r.kind==='ROLE_FOCUS'));assert.ok(report.recommendations.some(r=>r.kind==='FRESHNESS'));assert.ok(report.recommendations.every(r=>r.sampleSize>=5));assert.match(report.message,/hipotezami/i);
});

test('Strategy API is gated, user-scoped and records accepted experiments without changing profile automatically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'strategy-'));const app=createExtendedJobApp({nodeEnv:'test',port:0,appOrigin:'http://127.0.0.1',dataDir:dir,databasePath:join(dir,'test.sqlite'),adminEmails:new Set()});await new Promise<void>((resolve,reject)=>app.server.listen(0,'127.0.0.1',()=>resolve()).once('error',reject));const base=`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
 try{const reg=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Strategy Tester',email:'strategy@example.pl',password:'Bezpieczne123',acceptTerms:true,acceptPrivacy:true,analyticsConsent:false})});const rb=await reg.json() as {user:{id:string}};const cookie=reg.headers.get('set-cookie')?.split(';')[0]??'';app.store.updateProfile(rb.user.id,{desiredRoles:['rola-a'],location:null,commuteKm:null,remotePreferences:[],salaryMin:null,contractPreferences:[],shiftPreferences:{nights:null,weekends:null},availability:null});
  for(let i=0;i<12;i+=1){const title=i<6?'Rola A':'Rola B';const raw=`${title}\nFirma: F${i}\nMiejsce pracy: Gdynia\nWymagania testowe dla kandydata numer ${i}.`;const job=app.store.createJob(rb.user.id,raw,parseJobText(raw));app.db.db.prepare('UPDATE jobs SET normalized_title=?,published_at=? WHERE id=?').run(title.toLowerCase(),new Date(Date.now()-(i<6?2:12)*86400000).toISOString(),job);const application=app.store.createApplication(rb.user.id,job,i<5?'CONTACTED':'APPLIED');app.db.db.prepare('UPDATE applications SET created_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(),new Date().toISOString(),application);}
  assert.equal((await fetch(`${base}/api/strategy`,{headers:{cookie}})).status,404);new FeatureFlagService(app.db).set('strategy_engine',true,100);const response=await fetch(`${base}/api/strategy`,{headers:{cookie}});assert.equal(response.status,200);const payload=await response.json() as {report:{activated:boolean;recommendations:Array<{key:string;kind:string}>}};assert.equal(payload.report.activated,true);const recommendation=payload.report.recommendations.find(r=>r.kind==='ROLE_FOCUS');assert.ok(recommendation);
  const decision=await fetch(`${base}/api/strategy/recommendations/${encodeURIComponent(recommendation!.key)}/decision`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({decision:'ACCEPTED'})});assert.equal(decision.status,201);const saved=Number((app.db.db.prepare('SELECT COUNT(*) count FROM strategy_decisions WHERE user_id=?').get(rb.user.id) as {count:number}).count);const interventions=Number((app.db.db.prepare("SELECT COUNT(*) count FROM interventions WHERE user_id=? AND type='STRATEGY_EXPERIMENT'").get(rb.user.id) as {count:number}).count);assert.equal(saved,1);assert.equal(interventions,1);assert.deepEqual(app.store.getProfile(rb.user.id)?.desiredRoles,['rola-a']);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
