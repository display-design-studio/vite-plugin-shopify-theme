import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { Manifest } from 'vite';
import { canonicalPathInside, diagnostic, errorDetail, isRecord } from './config.js';

export const STATE_FILE = '.vite-shopify-theme.json';
const LOCK_DIR = '.vite-shopify-theme.lock';
const LOCK_FILE = 'owner.json';

export interface DevelopmentRecovery { snippet: string; developmentHash: string; original: { exists: boolean; content: string } }
export interface LockOwner { token: string; pid: number; mode: 'build' | 'development'; startedAt: string; development?: DevelopmentRecovery }
export interface OwnershipState { files: string[] }

export function readText(path: string, purpose: string): string {
  try { return readFileSync(path, 'utf8'); } catch (error) { throw diagnostic('FS_READ_FAILED', `Could not read ${purpose} at "${path}" (${errorDetail(error)}). Check that the file exists and is readable.`, error); }
}

function parseJson(path: string, purpose: string): unknown {
  const content = readText(path, purpose);
  try { return JSON.parse(content); } catch (error) { throw diagnostic('FS_JSON_INVALID', `Could not parse ${purpose} at "${path}" as JSON (${errorDetail(error)}). Repair or remove this file before retrying.`, error); }
}

export function removeFile(path: string, purpose: string): void {
  try { unlinkSync(path); } catch (error) { throw diagnostic('FS_REMOVE_FAILED', `Could not remove ${purpose} at "${path}" (${errorDetail(error)}). Check ownership and permissions, then retry.`, error); }
}

export function atomicWrite(path: string, content: string, mode?: number): void {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const existingMode = existsSync(path) ? statSync(path).mode & 0o777 : undefined;
    descriptor = openSync(temporary, 'wx', mode ?? existingMode ?? 0o666);
    writeFileSync(descriptor, content, 'utf8'); closeSync(descriptor); descriptor = undefined;
    if (existingMode !== undefined) chmodSync(temporary, existingMode);
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* best effort */ }
    if (existsSync(temporary)) try { unlinkSync(temporary); } catch { /* preserve primary error */ }
    throw diagnostic('FS_WRITE_FAILED', `Could not atomically write generated file "${path}" (${errorDetail(error)}). Check that its parent directory is writable and retry.`, error);
  }
}

export function sha(content: string): string { return createHash('sha256').update(content).digest('hex'); }

export function readOwnershipState(path: string): OwnershipState {
  const value = parseJson(path, 'generated asset ownership state');
  if (!isRecord(value) || !Array.isArray(value.files) || !value.files.every((file) => typeof file === 'string' && file.length > 0 && basename(file) === file)) {
    throw diagnostic('STATE_INVALID', `Generated asset ownership state at "${path}" has an invalid structure. Expected { "files": ["flat-asset-name"] }. Repair or remove this file before retrying; no recorded assets were deleted.`);
  }
  return { files: value.files as string[] };
}

export function readManifest(path: string): Manifest {
  const value = parseJson(path, 'Vite build manifest');
  if (!isRecord(value)) throw diagnostic('MANIFEST_INVALID', `Vite build manifest at "${path}" must be a JSON object. Run a clean Vite build and retry.`);
  for (const [key, chunk] of Object.entries(value)) {
    if (!isRecord(chunk) || typeof chunk.file !== 'string' || chunk.file.length === 0 || (chunk.imports !== undefined && !isStringArray(chunk.imports)) || (chunk.css !== undefined && !isStringArray(chunk.css))) {
      throw diagnostic('MANIFEST_INVALID', `Vite build manifest entry ${JSON.stringify(key)} at "${path}" is invalid. Run a clean Vite build and retry.`);
    }
  }
  return value as Manifest;
}

function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function lockPath(root: string): string { return canonicalPathInside(root, resolve(root, LOCK_DIR), 'Ownership lock'); }
function ownerPath(root: string): string { return canonicalPathInside(root, resolve(lockPath(root), LOCK_FILE), 'Ownership metadata'); }
function isOriginal(value: unknown): value is DevelopmentRecovery['original'] { return isRecord(value) && typeof value.exists === 'boolean' && typeof value.content === 'string'; }
function isDevelopmentRecovery(value: unknown): value is DevelopmentRecovery { return isRecord(value) && typeof value.snippet === 'string' && typeof value.developmentHash === 'string' && isOriginal(value.original); }
function isLockOwner(value: unknown): value is LockOwner {
  return isRecord(value) && typeof value.token === 'string' && value.token.length > 0 && Number.isInteger(value.pid) && (value.pid as number) > 0 && (value.mode === 'build' || value.mode === 'development') && typeof value.startedAt === 'string' && value.startedAt.length > 0 && (value.development === undefined || isDevelopmentRecovery(value.development));
}

function readOwner(root: string): LockOwner | undefined {
  const path = ownerPath(root);
  if (!existsSync(lockPath(root))) return undefined;
  if (!existsSync(path)) throw diagnostic('LOCK_METADATA_MISSING', `Ownership lock "${lockPath(root)}" is missing metadata "${path}". Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`);
  let value: unknown;
  try { value = parseJson(path, 'ownership metadata'); } catch (error) { throw diagnostic('LOCK_METADATA_INVALID', `Ownership metadata at "${path}" could not be read or parsed (${errorDetail(error)}). Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`, error); }
  if (!isLockOwner(value)) throw diagnostic('LOCK_METADATA_INVALID', `Ownership metadata at "${path}" has an invalid structure. Do not remove it while another process may be running; after confirming no Vite process owns this theme, remove the lock directory and retry.`);
  return value;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function recoverDevelopment(root: string, owner: LockOwner): void {
  const recovery = owner.development;
  if (!recovery || !existsSync(recovery.snippet)) return;
  let snippet: string;
  try { snippet = canonicalPathInside(root, recovery.snippet, 'Recorded recovery snippet', true); } catch { return; }
  if (sha(readText(snippet, 'temporary development snippet')) !== recovery.developmentHash) return;
  if (recovery.original.exists) atomicWrite(snippet, recovery.original.content); else removeFile(snippet, 'temporary development snippet');
}

export function acquireLock(root: string, mode: LockOwner['mode']): LockOwner {
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, mode, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { mkdirSync(lockPath(root)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw diagnostic('LOCK_CREATE_FAILED', `Could not create ownership lock at "${lockPath(root)}" (${errorDetail(error)}). Check that the theme root is writable and retry.`, error);
      const current = readOwner(root);
      if (current && processIsAlive(current.pid)) throw diagnostic('LOCK_ACTIVE', `Cannot start ${mode}: ${current.mode} process ${current.pid} has owned ${root} since ${current.startedAt}. Stop it before trying again.`);
      if (current) recoverDevelopment(root, current);
      const stalePath = `${lockPath(root)}.stale.${owner.token}`;
      try { renameSync(lockPath(root), stalePath); rmSync(stalePath, { recursive: true }); } catch (removeError) {
        if ((removeError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw diagnostic('LOCK_RECLAIM_FAILED', `Could not reclaim stale ownership at "${lockPath(root)}" (${errorDetail(removeError)}). Check ownership and permissions, then retry.`, removeError);
      }
      continue;
    }
    try { atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`); return owner; } catch (error) {
      try { rmSync(lockPath(root), { recursive: true }); } catch { /* keep atomic-write diagnostic */ }
      throw error;
    }
  }
  throw diagnostic('LOCK_ACQUIRE_FAILED', `Could not acquire ownership of theme root "${root}" after multiple attempts. Stop other Vite processes and retry.`);
}

export function updateLock(root: string, owner: LockOwner): void {
  const current = readOwner(root);
  if (!current || current.token !== owner.token) throw diagnostic('LOCK_CHANGED', `Theme ownership at "${lockPath(root)}" changed unexpectedly. Stop all Vite processes using this theme before retrying.`);
  atomicWrite(ownerPath(root), `${JSON.stringify(owner, null, 2)}\n`);
}

export function releaseLock(root: string, owner: LockOwner | undefined): void {
  if (!owner || readOwner(root)?.token !== owner.token) return;
  try { rmSync(lockPath(root), { recursive: true }); } catch (error) { throw diagnostic('LOCK_RELEASE_FAILED', `Could not release theme ownership at "${lockPath(root)}" (${errorDetail(error)}). Remove the lock directory after confirming this process has stopped.`, error); }
}
