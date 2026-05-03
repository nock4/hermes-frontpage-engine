import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const defaultSampleManifest = path.join(repoRoot, 'examples', 'signals', 'sample-signals.json')
const defaultSampleNotes = path.join(repoRoot, 'examples', 'signals', 'sample-notes')
const defaultInspirationOverrideManifest = path.join(repoRoot, 'tmp', 'next-run-inspiration-override.json')

export const portableConfigDefaults = {
  input_mode: 'markdown-folder',
  input_root: defaultSampleNotes,
  signal_manifest: defaultSampleManifest,
  inspiration_override_manifest: defaultInspirationOverrideManifest,
  browser_harness_path: 'browser-harness',
  openai_model: 'gpt-5.5',
  openai_image_model: 'gpt-image-2',
  image_backend: 'hermes',
  timezone: 'UTC',
  sample_data_enabled: false,
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

function resolveMaybeRelative(baseDir, value) {
  if (typeof value !== 'string' || !value.trim()) return value ?? null
  if (path.isAbsolute(value)) return value
  return path.resolve(baseDir, value)
}

function readJsonConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    ...parsed,
    input_root: resolveMaybeRelative(path.dirname(configPath), parsed.input_root),
    signal_manifest: resolveMaybeRelative(path.dirname(configPath), parsed.signal_manifest),
    inspiration_override_manifest: resolveMaybeRelative(path.dirname(configPath), parsed.inspiration_override_manifest),
    browser_harness_path: parsed.browser_harness_path || portableConfigDefaults.browser_harness_path,
  }
}

export function resolveFrontpageConfig({ cwd = repoRoot, env = process.env, explicitConfigPath = null } = {}) {
  const configPath = explicitConfigPath
    ? resolveMaybeRelative(cwd, explicitConfigPath)
    : env.DFE_CONFIG_PATH
      ? resolveMaybeRelative(cwd, env.DFE_CONFIG_PATH)
      : null

  const fileConfig = configPath && pathExists(configPath)
    ? readJsonConfig(configPath)
    : {}

  const sampleEnabled = env.DFE_SAMPLE_DATA_ENABLED != null
    ? /^(1|true|yes)$/i.test(String(env.DFE_SAMPLE_DATA_ENABLED))
    : fileConfig.sample_data_enabled ?? portableConfigDefaults.sample_data_enabled

  const resolved = {
    config_path: configPath,
    input_mode: env.DFE_INPUT_MODE || fileConfig.input_mode || portableConfigDefaults.input_mode,
    input_root: env.DFE_INPUT_ROOT
      ? resolveMaybeRelative(cwd, env.DFE_INPUT_ROOT)
      : fileConfig.input_root || portableConfigDefaults.input_root,
    signal_manifest: env.DFE_SIGNAL_MANIFEST
      ? resolveMaybeRelative(cwd, env.DFE_SIGNAL_MANIFEST)
      : fileConfig.signal_manifest || portableConfigDefaults.signal_manifest,
    inspiration_override_manifest: env.DFE_INSPIRATION_OVERRIDE
      ? resolveMaybeRelative(cwd, env.DFE_INSPIRATION_OVERRIDE)
      : fileConfig.inspiration_override_manifest || portableConfigDefaults.inspiration_override_manifest,
    browser_harness_path: env.BROWSER_HARNESS_PATH || fileConfig.browser_harness_path || portableConfigDefaults.browser_harness_path,
    openai_model: env.OPENAI_MODEL || fileConfig.openai_model || portableConfigDefaults.openai_model,
    openai_image_model: env.OPENAI_IMAGE_MODEL || fileConfig.openai_image_model || portableConfigDefaults.openai_image_model,
    image_backend: env.DFE_IMAGE_BACKEND || fileConfig.image_backend || portableConfigDefaults.image_backend,
    timezone: env.TZ || fileConfig.timezone || portableConfigDefaults.timezone,
    sample_data_enabled: sampleEnabled,
    sample_manifest_path: defaultSampleManifest,
    sample_input_root: defaultSampleNotes,
    repo_root: repoRoot,
  }

  if (resolved.sample_data_enabled) {
    resolved.input_mode = 'manifest'
    resolved.signal_manifest = defaultSampleManifest
  }

  return resolved
}
