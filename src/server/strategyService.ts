import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import { buildStrategyReport, type StrategyRecommendation, type StrategyReport, type StrategySegment } from '../domain/strategyEngine.js';
import { LocalLabourService } from './localLabourService.js';
import { SkillRoiService } from './skillRoiService.js';

type ApplicationRow={id:string;status:string;created_at:string;title:string|null;normalized_title:string|null;contract_type:string|null;published_at:string|null};
type OutcomeRow={application_id:string;outcome_type:string};
const positiveOutcome=(value:string):boolean=>['CONTACTED','INTERVIEW','OFFER'].includes(value.toUpperCase());
const interviewOutcome=(value:string):boolean=>value.toUpperCase().includes('INTERVIEW')||value.toUpperCase().includes('ROZMOW');
const offerOutcome=(value:string):boolean=>value.toUpperCase().includes('OFFER')||value.toUpperCase().includes('OFERT');

function segments(rows:ApplicationRow[],progressed:Set<string>,pick:(row:ApplicationRow)=>string|null):StrategySegment[]{const map=new Map<string,{sampleSize:number;progressed:number}>();for(const row of rows){const label=pick(row)?.trim();if(!label)continue;const current=map.get(label)??{sampleSize:0,progressed:0};current.sampleSize+=1;if(progressed.has(row.id))current.progressed+=1;map.set(label,current);}return[...map.entries()].map(([label,value])=>({label,...value}));}

export class StrategyService{
 constructor(private readonly database:JobDatabase){}
 build(userId:string):StrategyReport{
  const applications=this.database.db.prepare(`SELECT a.id,a.status,a.created_at,j.title,j.normalized_title,j.contract_type,j.published_at FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? AND a.status<>'SAVED' ORDER BY a.created_at`).all(userId) as unknown as ApplicationRow[];
  const outcomes=this.database.db.prepare(`SELECT o.application_id,o.outcome_type FROM outcomes o JOIN applications a ON a.id=o.application_id WHERE a.user_id=?`).all(userId) as unknown as OutcomeRow[];
  const byApp=new Map<string,string[]>();for(const outcome of outcomes){const values=byApp.get(outcome.application_id)??[];values.push(outcome.outcome_type);byApp.set(outcome.application_id,values);}
  const progressed=new Set<string>(),interviews=new Set<string>(),offers=new Set<string>();
  for(const app of applications){const values=byApp.get(app.id)??[];if(['CONTACTED','INTERVIEW','OFFER'].includes(app.status)||values.some(positiveOutcome))progressed.add(app.id);if(['INTERVIEW','OFFER'].includes(app.status)||values.some(interviewOutcome))interviews.add(app.id);if(app.status==='OFFER'||values.some(offerOutcome))offers.add(app.id);}
  let freshSample=0,freshProgressed=0,olderSample=0,olderProgressed=0;for(const app of applications){if(!app.published_at)continue;const published=Date.parse(app.published_at),applied=Date.parse(app.created_at);if(!Number.isFinite(published)||!Number.isFinite(applied))continue;const age=(applied-published)/(24*60*60*1000);if(age<0)continue;if(age<=7){freshSample+=1;if(progressed.has(app.id))freshProgressed+=1;}else{olderSample+=1;if(progressed.has(app.id))olderProgressed+=1;}}
  let radius=null;try{const labour=new LocalLabourService(this.database).build(userId);if(labour.plusTenKm.status==='MAY_HELP'&&labour.plusTenKm.areaName&&labour.plusTenKm.distanceKm!==null)radius={areaName:labour.plusTenKm.areaName,distanceKm:labour.plusTenKm.distanceKm,confidence:labour.confidence,message:labour.plusTenKm.message};}catch{/* profile/public data may be insufficient */}
  let skill=null;try{const candidate=new SkillRoiService(this.database).build(userId).candidates[0];if(candidate)skill={skill:candidate.skill,requirementCount:candidate.requirementCount,potentiallyUnlockedJobs:candidate.potentiallyUnlockedJobs,confidence:candidate.confidence,nextStep:candidate.nextStep};}catch{/* skill evidence may be unavailable */}
  return buildStrategyReport({applications:applications.length,responses:progressed.size,interviews:interviews.size,offers:offers.size,roles:segments(applications,progressed,row=>row.normalized_title??row.title),contracts:segments(applications,progressed,row=>row.contract_type),fresh:freshSample?{label:'≤7 dni',sampleSize:freshSample,progressed:freshProgressed}:null,older:olderSample?{label:'>7 dni',sampleSize:olderSample,progressed:olderProgressed}:null,radius,skill});
 }
 recordDecision(userId:string,recommendationKey:string,decision:'ACCEPTED'|'DISMISSED'):StrategyRecommendation{
  const report=this.build(userId);const recommendation=report.recommendations.find(item=>item.key===recommendationKey);if(!recommendation)throw new Error('Nie znaleziono aktualnej rekomendacji strategii.');const now=new Date().toISOString(),snapshot=JSON.stringify(recommendation);this.database.db.exec('BEGIN IMMEDIATE');try{this.database.db.prepare('INSERT INTO strategy_decisions(id,user_id,recommendation_key,decision,confidence,sample_size,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),userId,recommendation.key,decision,recommendation.confidence,recommendation.sampleSize,snapshot,now);if(decision==='ACCEPTED')this.database.db.prepare('INSERT INTO interventions(id,user_id,type,details,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),userId,'STRATEGY_EXPERIMENT',snapshot,now);this.database.db.exec('COMMIT');}catch(error){this.database.db.exec('ROLLBACK');throw error;}return recommendation;
 }
}
