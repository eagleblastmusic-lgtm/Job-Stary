export type CareerFactStatus =
  | 'CONFIRMED'
  | 'INFERRED'
  | 'UNKNOWN'
  | 'NOT_POSSESSED'
  | 'EXPIRED'
  | 'CONFLICTING';

export type RequirementImportance = 'MUST_HAVE' | 'NICE_TO_HAVE' | 'UNKNOWN';
export type Recommendation = 'APPLY_NOW' | 'APPLY' | 'CONSIDER' | 'PROBABLY_SKIP' | 'LOW_FIT';
export type ApplicationStatus = 'SAVED' | 'APPLIED' | 'CONTACTED' | 'INTERVIEW' | 'OFFER' | 'CLOSED';
export type SalaryMode = 'EXCLUDE_LOWER' | 'DISCLOSED_ONLY';

export interface CareerProfile {
  desiredRoles: string[];
  location: string | null;
  commuteKm: number | null;
  remotePreferences: string[];
  salaryMin: number | null;
  salaryMode?: SalaryMode;
  contractPreferences: string[];
  shiftPreferences: {
    nights: boolean | null;
    weekends: boolean | null;
  };
  availability: string | null;
}

export interface CareerFact {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  level: string | null;
  source: string;
  status: CareerFactStatus;
  confidence: number;
  evidence: string | null;
  allowedForCv: boolean;
}

export interface CareerExperience {
  id: string;
  employer: string;
  title: string;
  normalizedTitle: string;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  description: string | null;
  achievements: string[];
}

export interface EducationRecord {
  id: string;
  institution: string;
  field: string | null;
  degree: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface ParsedJobRequirement {
  type: string;
  canonicalRequirement: string;
  importance: RequirementImportance;
  confidence: number;
  provenance: string;
}

export interface ParsedJob {
  title: string | null;
  normalizedTitle: string | null;
  company: string | null;
  location: string | null;
  remoteType: 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: 'MONTH' | 'HOUR' | 'UNKNOWN';
  grossNet: 'GROSS' | 'NET' | 'UNKNOWN';
  workingHours: string | null;
  shiftPattern: string | null;
  nightWork: boolean | null;
  weekendWork: boolean | null;
  travelRequired: boolean | null;
  applicationMethod: string | null;
  deadline: string | null;
  publishedAt: string | null;
  requirements: ParsedJobRequirement[];
  fingerprint: string;
}

export interface DecisionDimensionSet {
  capabilityFit: number;
  requirementFit: number;
  preferenceFit: number;
  salaryFit: number;
  commuteFit: number;
  contractFit: number;
  freshness: number;
  uncertainty: number;
}

export interface DecisionExplanation {
  why: string[];
  unknown: string[];
  missing: string[];
  hardConstraints: string[];
  conclusion: string;
}

export interface JobDecisionResult {
  recommendation: Recommendation;
  dimensions: DecisionDimensionSet;
  explanation: DecisionExplanation;
  modelVersion: string;
}

export interface CvDocument {
  name: string;
  headline: string;
  summary: string;
  facts: CareerFact[];
  experiences: CareerExperience[];
  education: EducationRecord[];
  desiredRoles: string[];
}

export interface ApplicationPackage {
  cv: CvDocument;
  message: string;
  fitSummary: string;
}
