import type { IncomingMessage,ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { StrategyService } from './strategyService.js';
import { enforceExtendedOrigin,requireExtendedUser } from './extendedAuth.js';

export async function handleStrategyApi(req:IncomingMessage,res:ServerResponse,pathname:string,store:AppStore,db:JobDatabase,config:AppConfig):Promise<boolean>{
 if(!pathname.startsWith('/api/strategy'))return false;
 enforceExtendedOrigin(req,config);const user=requireExtendedUser(req,store);
 if(!new FeatureFlagService(db).isEnabled('strategy_engine',{userId:user.id,role:user.role}))throw new HttpError(404,'Strategia nie jest obecnie dostępna.','FEATURE_DISABLED');
 const service=new StrategyService(db),method=req.method??'GET';
 if(method==='GET'&&pathname==='/api/strategy'){const report=service.build(user.id);store.analytics(user.id,'strategy_viewed',{confidence:report.confidence,recommendationCount:report.recommendations.length,activated:report.activated});sendJson(res,200,{report});return true;}
 const decisionMatch=pathname.match(/^\/api\/strategy\/recommendations\/([^/]+)\/decision$/);
 if(method==='POST'&&decisionMatch){const body=await readJson(req),decision=boundedStringField(body,'decision',20,true);if(decision!=='ACCEPTED'&&decision!=='DISMISSED')throw new HttpError(400,'Decyzja musi mieć wartość ACCEPTED albo DISMISSED.','VALIDATION_ERROR');let recommendation;try{recommendation=service.recordDecision(user.id,decodeURIComponent(decisionMatch[1]??''),decision);}catch(error){if(error instanceof Error&&error.message==='Nie znaleziono aktualnej rekomendacji strategii.')throw new HttpError(404,error.message,'NOT_FOUND');throw error;}store.analytics(user.id,'strategy_recommendation_decided',{kind:recommendation.kind,decision,confidence:recommendation.confidence});sendJson(res,201,{recommendation,decision});return true;}
 sendJson(res,404,{error:{code:'NOT_FOUND',message:'Nie znaleziono endpointu.'}});return true;
}
