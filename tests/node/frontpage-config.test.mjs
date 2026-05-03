import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { portableConfigDefaults, resolveFrontpageConfig } from '../../scripts/lib/frontpage-config.mjs'

describe('frontpage config', () => {
  it('loads config from DFE_CONFIG_PATH', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-config-'))
    const configPath = path.join(tempDir, 'frontpage.json')
    await fs.writeFile(configPath, JSON.stringify({
      input_mode: 'manifest',
      signal_manifest: './signals.json',
      timezone: 'America/Detroit',
    }))

    const resolved = resolveFrontpageConfig({
      cwd: tempDir,
      env: { DFE_CONFIG_PATH: configPath },
    })

    expect(resolved.input_mode).toBe('manifest')
    expect(resolved.signal_manifest).toBe(path.join(tempDir, 'signals.json'))
    expect(resolved.timezone).toBe('America/Detroit')
  })

  it('lets env vars override config values', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dfe-config-'))
    const configPath = path.join(tempDir, 'frontpage.json')
    await fs.writeFile(configPath, JSON.stringify({
      input_mode: 'markdown-folder',
      input_root: './notes',
      openai_model: 'config-model',
    }))

    const resolved = resolveFrontpageConfig({
      cwd: tempDir,
      env: {
        DFE_CONFIG_PATH: configPath,
        DFE_INPUT_MODE: 'manifest',
        DFE_SIGNAL_MANIFEST: './override.json',
        DFE_INSPIRATION_OVERRIDE: './inspiration.json',
        OPENAI_MODEL: 'env-model',
      },
    })

    expect(resolved.input_mode).toBe('manifest')
    expect(resolved.signal_manifest).toBe(path.join(tempDir, 'override.json'))
    expect(resolved.inspiration_override_manifest).toBe(path.join(tempDir, 'inspiration.json'))
    expect(resolved.openai_model).toBe('env-model')
  })

  it('falls back safely when optional config is missing', () => {
    const resolved = resolveFrontpageConfig({ env: {} })
    expect(resolved.browser_harness_path).toBe(portableConfigDefaults.browser_harness_path)
    expect(resolved.openai_image_model).toBe(portableConfigDefaults.openai_image_model)
    expect(resolved.image_backend).toBe(portableConfigDefaults.image_backend)
    expect(resolved.timezone).toBe(portableConfigDefaults.timezone)
  })

  it('does not require a Nick-specific absolute path by default', () => {
    const resolved = resolveFrontpageConfig({ env: {} })
    expect(resolved.input_root).not.toContain('/Users/nickgeorge-studio/Documents/nicks-mind-map')
    expect(resolved.browser_harness_path).not.toContain('/Users/nickgeorge-studio/Projects/browser-harness')
  })
})
