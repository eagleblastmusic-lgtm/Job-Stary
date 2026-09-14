import type { IncomingMessage } from 'node:http';
import type { AppConfig } from './config.js';
import { AppStore, type UserRecord } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { HttpError } from './http.js';

export function requireExtendedUser(req:IncomingMessage,store:AppStore):UserRecord{const raw=parseCookies(req.headers.cookie).job_session;if(!raw)throw new HttpError(401,'Zaloguj się, aby kontynuować.','UNAUTHENTICATED');const user=store.getUserBySession(hashSessionToken(raw));if(!user)throw new HttpError(401,'Zaloguj się, aby kontynuować.','UNAUTHENTICATED');return user;}
export function enforceExtendedOrigin(req:IncomingMessage,config:AppConfig):void{if(!['POST','PUT','PATCH','DELETE'].includes(req.method??'GET'))return;const site=req.headers['sec-fetch-site'];if(site&&site!=='same-origin'&&site!=='none')throw new HttpError(403,'Nieprawidłowe źródło żądania.','ORIGIN_REJECTED');const origin=req.headers.origin;if(origin&&origin!==config.appOrigin)throw new HttpError(403,'Nieprawidłowe źródło żądania.','ORIGIN_REJECTED');}
