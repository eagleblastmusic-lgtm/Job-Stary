import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { isLearningBudget, type LearningTargetKind } from '../domain/learning.js';
import { LearningService } from './learningService.js';

function user(req: IncomingMessage, store: AppStore) { const token = parseCookies(req.headers.cookie).job_session; if (!token) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED'); const value = store.getUserBySession(hashSessionToken(token)); if (!value) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED'); return value; }
function origin(req: IncomingMessage, config: AppConfig): void { if (!['POST','PUT','PATCH','DELETE'].includes(req.method ?? 'GET')) return; const site=req.headers['sec-fetch-site']; if (site && site!=='same-origin' && site!=='none') throw new HttpError(403,'Nieprawidłowe źródło żądania.','ORIGIN_REJECTED'); if (req.headers.origin && req.headers.origin!==config.appOrigin) throw new HttpError(403,'Nieprawidłowe źródło żądania.','ORIGIN_REJECTED'); }
function targetKind(value: unknown): LearningTargetKind { if (value==='INTERVIEW'||value==='MISSING_SKILL'||value==='CERTIFICATION'||value==='JOB_REQUIREMENT') return value; throw new HttpError(400,'Nieprawidłowy typ celu nauki.','VALIDATION_ERROR'); }

export async function handleLearningApi(req: IncomingMessage,res: ServerResponse,pathname: string,store: AppStore,db: JobDatabase,config: AppConfig): Promise<boolean> {
  if (!pathname.startsWith('/api/learning')) return false; origin(req,config); const u=user(req,store);
  if (!new FeatureFlagService(db).isEnabled('just_in_time_learning',{userId:u.id,role:u.role})) throw new HttpError(404,'Szybka nauka nie jest obecnie dostępna.','FEATURE_DISABLED');
  const service=new LearningService(db); const method=req.method??'GET';
  if (method==='GET' && pathname==='/api/learning/targets') { sendJson(res,200,{targets:service.targets(u.id)}); return true; }
  if (method==='POST' && pathname==='/api/learning/plan') { const body=await readJson(req); const kind=targetKind(body.targetKind); const key=boundedStringField(body,'targetKey',500,true,1)??''; const budget=body.budgetMinutes; if (typeof budget!=='number'||!isLearningBudget(budget)) throw new HttpError(400,'Budżet nauki musi wynosić 15, 30, 60 albo 120 minut.','VALIDATION_ERROR'); let plan; try { plan=service.createPlan(u.id,kind,key,budget); } catch(error) { if(error instanceof Error && error.message==='Nie znaleziono celu nauki.') throw new HttpError(404,error.message,'NOT_FOUND'); throw error; } store.analytics(u.id,'learning_plan_created',{targetKind:kind,budgetMinutes:budget}); sendJson(res,201,{plan}); return true; }
  const complete=pathname.match(/^\/api\/learning\/sessions\/([^/]+)\/complete$/); if(method==='PATCH'&&complete){ try{service.complete(u.id,complete[1]??'');}catch(error){if(error instanceof Error&&error.message==='Nie znaleziono sesji nauki.')throw new HttpError(404,error.message,'NOT_FOUND');throw error;} store.analytics(u.id,'learning_session_completed'); sendJson(res,200,{ok:true}); return true; }
  sendJson(res,404,{error:{code:'NOT_FOUND',message:'Nie znaleziono endpointu.'}}); return true;
}
