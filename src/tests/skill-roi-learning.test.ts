import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildSkillRoiCandidate } from '../domain/skillRoi.js';
import { buildLearningPlan } from '../domain/learning.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';
import { parseJobText } from '../domain/jobParser.js';

test('Skill ROI never turns missing Career Truth into a claim that the skill is absent and shows small-sample uncertainty', () => {
  const item=buildSkillRoiCandidate({skill:'UDT',normalizedSkill:'udt',ontologyType:'CREDENTIAL',requirementCount:3,mustHaveCount:2,savedJobSample:4,potentiallyUnlockedJobs:1,localMentions:0,localSourceCount:0,salaryDifference:null,salarySample:0,possession:'NOT_CONFIRMED',assumption:null});
  assert.equal(item.confidence,'ZA_MALO_DANYCH');
  assert.match(item.uncertainty.join(' '),/nie oznacza, że jej nie masz/i);
  assert.match(item.uncertainty.join(' '),/nie wyliczamy finansowego ROI/i);
  assert.equal(item.potentiallyUnlockedJobs,1);
});

test('Just-in-Time Learning produces bounded plans tied to a supplied real target and never certifies the user', () => {
  const target={kind:'CERTIFICATION' as const,key:'udt',label:'UDT',context:'Wymaganie zapisanej oferty.',evidence:['UDT jest MUST_HAVE w zapisanej ofercie.'],unknowns:['Nie znamy aktualnych zasad certyfikacji.']};
  const plan=buildLearningPlan(target,60);
  assert.equal(plan.tasks.reduce((sum,item)=>sum+item.minutes,0),60);
  assert.match(plan.boundaries.join(' '),/nie potwierdza certyfikacji/i);
  assert.equal(plan.target.key,'udt');
});

test('Skill ROI and Learning APIs are fail-closed and operate on user-owned saved-job evidence after rollout', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skill-roi-learning-'));const app=createExtendedJobApp({nodeEnv:'test',port:0,appOrigin:'http://127.0.0.1',dataDir:dir,databasePath:join(dir,'test.sqlite'),adminEmails:new Set()});
  await new Promise<void>((resolve,reject)=>app.server.listen(0,'127.0.0.1',()=>resolve()).once('error',reject));const base=`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try{
    const register=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Skill Tester',email:'skill@example.pl',password:'Bezpieczne123',acceptTerms:true,acceptPrivacy:true,analyticsConsent:false})});assert.equal(register.status,201);const body=await register.json() as {user:{id:string}};const cookie=register.headers.get('set-cookie')?.split(';')[0]??'';
    const raw='Magazynier\nFirma: Test\nMiejsce pracy: Gdynia\n6000 PLN brutto\nWymagane uprawnienia UDT.';const jobId=app.store.createJob(body.user.id,raw,parseJobText(raw));
    app.db.db.prepare('INSERT INTO job_requirements(id,job_id,type,canonical_requirement,importance,confidence,provenance) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),jobId,'CREDENTIAL','UDT','MUST_HAVE',1,'test');
    assert.equal((await fetch(`${base}/api/skill-roi`,{headers:{cookie}})).status,404);assert.equal((await fetch(`${base}/api/learning/targets`,{headers:{cookie}})).status,404);
    const flags=new FeatureFlagService(app.db);flags.set('skill_roi',true,100);flags.set('just_in_time_learning',true,100);
    const roi=await fetch(`${base}/api/skill-roi`,{headers:{cookie}});assert.equal(roi.status,200);const roiBody=await roi.json() as {report:{candidates:Array<{skill:string;possession:string;potentiallyUnlockedJobs:number}>}};const udt=roiBody.report.candidates.find(item=>item.skill==='UDT');assert.ok(udt);assert.equal(udt?.possession,'NOT_CONFIRMED');assert.equal(udt?.potentiallyUnlockedJobs,1);
    const save=await fetch(`${base}/api/skill-roi/assumptions/udt`,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({skill:'UDT',estimatedCost:800,estimatedHours:12,certificationRequired:true,certificationNote:'do weryfikacji w oficjalnym źródle'})});assert.equal(save.status,200);
    const targets=await fetch(`${base}/api/learning/targets`,{headers:{cookie}});assert.equal(targets.status,200);const targetBody=await targets.json() as {targets:Array<{kind:string;key:string}>};const target=targetBody.targets.find(item=>item.key==='udt');assert.ok(target);
    const plan=await fetch(`${base}/api/learning/plan`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({targetKind:target?.kind,targetKey:'udt',budgetMinutes:30})});assert.equal(plan.status,201);assert.equal(((await plan.json()) as {plan:{budgetMinutes:number}}).plan.budgetMinutes,30);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
