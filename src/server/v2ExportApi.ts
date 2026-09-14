import type { IncomingMessage,ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { sendJson } from './http.js';
import { enforceExtendedOrigin,requireExtendedUser } from './extendedAuth.js';

export async function handleV2ExportApi(req:IncomingMessage,res:ServerResponse,pathname:string,store:AppStore,db:JobDatabase,config:AppConfig):Promise<boolean>{
 if(pathname!=='/api/export')return false;
 enforceExtendedOrigin(req,config);const user=requireExtendedUser(req,store);
 if((req.method??'GET')!=='GET')return false;
 const data=store.exportUserData(user.id);
 const add=(name:string,sql:string)=>{data[name]=db.db.prepare(sql).all(user.id);};
 add('daily_actions','SELECT * FROM daily_actions WHERE user_id=? ORDER BY created_at');
 add('notification_preferences','SELECT * FROM notification_preferences WHERE user_id=?');
 add('notifications','SELECT * FROM notifications WHERE user_id=? ORDER BY created_at');
 add('job_source_observations','SELECT * FROM job_source_observations WHERE user_id=? ORDER BY first_seen_at');
 add('job_feed_states','SELECT * FROM job_feed_states WHERE user_id=? ORDER BY updated_at');
 add('effective_wage_preferences','SELECT * FROM effective_wage_preferences WHERE user_id=?');
 add('skill_roi_assumptions','SELECT * FROM skill_roi_assumptions WHERE user_id=? ORDER BY normalized_skill');
 add('learning_sessions','SELECT * FROM learning_sessions WHERE user_id=? ORDER BY created_at');
 add('career_transition_explorations','SELECT * FROM career_transition_explorations WHERE user_id=? ORDER BY created_at');
 add('outcome_inbox_suggestions','SELECT * FROM outcome_inbox_suggestions WHERE user_id=? ORDER BY created_at');
 add('strategy_decisions','SELECT * FROM strategy_decisions WHERE user_id=? ORDER BY created_at');
 add('interventions','SELECT * FROM interventions WHERE user_id=? ORDER BY created_at');
 store.audit(user.id,'DATA_EXPORTED','user',user.id,{scope:'v2'});
 sendJson(res,200,data);return true;
}
