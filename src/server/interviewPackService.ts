import type { AppStore } from './store.js';
import { buildInterviewPack, type InterviewPack } from '../domain/interviewPack.js';

export class InterviewPackService {
  constructor(private readonly store: AppStore) {}

  generate(userId: string, applicationId: string): InterviewPack {
    const application = this.store.getApplication(userId, applicationId);
    if (!application) throw new Error('Nie znaleziono aplikacji.');
    const found = this.store.getJob(userId, application.job_id);
    if (!found) throw new Error('Nie znaleziono aplikacji.');
    return buildInterviewPack({
      job: found.job,
      facts: this.store.listFacts(userId),
      experiences: this.store.listExperiences(userId),
      education: this.store.listEducation(userId),
      profile: this.store.getProfile(userId)
    });
  }
}
