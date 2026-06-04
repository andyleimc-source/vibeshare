// Read/write vibeshare config at ~/.config/vibeshare/config.json
// (honors $XDG_CONFIG_HOME). Stores only the chosen project + expected account.

import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'vibeshare');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeConfig(cfg) {
  mkdirSync(configDir(), { recursive: true });
  const merged = { version: 1, ...readConfig(), ...cfg };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

export function hasConfig() {
  return existsSync(configPath());
}
