import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CvDocument } from '../domain/types.js';

const execFileAsync = promisify(execFile);

export async function cvToPdf(cv: CvDocument, pythonBin: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'job-cv-'));
  const jsonPath = join(dir, 'cv.json');
  const pdfPath = join(dir, 'cv.pdf');
  try {
    await writeFile(jsonPath, JSON.stringify(cv), 'utf8');
    await execFileAsync(pythonBin, [resolve(process.cwd(), 'scripts/render_cv_pdf.py'), jsonPath, pdfPath], { timeout: 20000, maxBuffer: 1_000_000 });
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
