export const FEATURE_FLAG_KEYS = [
  'today',
  'notifications',
  'interview_pack',
  'skill_roi',
  'just_in_time_learning',
  'career_transition',
  'outcome_inbox',
  'strategy_engine',
  'job_feed',
  'bottleneck',
  'local_labour',
  'effective_wage'
] as const;

export type FeatureFlagKey = typeof FEATURE_FLAG_KEYS[number];
export type FeatureRolloutPercent = 0 | 10 | 50 | 100;

export interface FeatureFlagState { key: FeatureFlagKey; enabled: boolean; rolloutPercent: number; }
export interface FeatureFlagContext { userId: string; role: 'USER' | 'ADMIN'; }
export function isFeatureFlagKey(value: string): value is FeatureFlagKey { return (FEATURE_FLAG_KEYS as readonly string[]).includes(value); }
export function isFeatureRolloutPercent(value: number): value is FeatureRolloutPercent { return value===0||value===10||value===50||value===100; }
export function rolloutBucket(userId: string,key: FeatureFlagKey): number { const value=`${key}:${userId}`;let hash=0x811c9dc5;for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193);}return(hash>>>0)%100; }
export function featureEnabledForContext(flag: FeatureFlagState,context: FeatureFlagContext): boolean { if(!flag.enabled)return false;if(context.role==='ADMIN')return true;if(flag.rolloutPercent>=100)return true;if(flag.rolloutPercent<=0)return false;return rolloutBucket(context.userId,flag.key)<flag.rolloutPercent; }
