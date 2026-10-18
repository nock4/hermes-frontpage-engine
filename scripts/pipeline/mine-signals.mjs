import path from 'node:path'
import { claimPreparedReserve, defaultReserveDir, finalizeReserveClaim, ledgerFingerprint, reserveConfigFingerprint } from '../lib/artwork-reserve.mjs'

const defaultReserve = { claim: claimPreparedReserve, finalize: finalizeReserveClaim }

export function createMineSignalsStep({ options, context, recentDiversityAvoidTerms, recentSourceKeys = new Set(), root, runDir, mineSignals, reserve = defaultReserve, reserveDir = defaultReserveDir() }) {
  return {
    name: 'Mine source signals',
    tool: options.inputMode === 'manifest'
      ? 'JSON manifest adapter'
      : options.inputMode === 'markdown-folder'
        ? 'Markdown folder adapter'
        : 'Obsidian allowlist adapter',
    command: [
      'internal:mine-signals',
      `--input-mode ${options.inputMode}`,
      options.inputRoot ? `--input-root ${JSON.stringify(options.inputRoot)}` : null,
      options.signalManifest ? `--signal-manifest ${JSON.stringify(options.signalManifest)}` : null,
      options.inspirationOverride ? `--inspiration-override ${JSON.stringify(options.inspirationOverride)}` : null,
      `--window-days ${options.windowDays}`,
      `--max-notes ${options.maxNotes}`,
      `--avoid-recent-terms ${JSON.stringify(recentDiversityAvoidTerms.join(','))}`,
    ].filter(Boolean).join(' '),
    run: async () => {
      const mine = preparedReserve => mineSignals({
        ...options,
        bookmarkFirst: options.inputMode === 'obsidian-allowlist',
        diversityAvoidTerms: recentDiversityAvoidTerms,
        recentSourceKeys,
        inspirationOverride: context.inspirationOverride,
        preparedReserve,
      }, runDir)
      // Only the normal publishing bookmark path may use a prepared reserve.
      // Explicit overrides, sample/manifest and manual non-publish runs never do.
      const override = context.inspirationOverride
      const reserveEligible = options.publish === true && options.inputMode === 'obsidian-allowlist'
        && !override?.active && !override?.source_url && process.env.DFE_ARTWORK_RESERVE !== '0'
      let claimed = null
      if (reserveEligible) {
        // The reserve is optional infrastructure: any fingerprint/claim error is
        // recorded and the run continues with ordinary fresh bounded intake.
        try {
          const fingerprints = {
            ...await reserveConfigFingerprint({ model: options.model, inputRoot: options.inputRoot, frontpageConfigPath: options.configPath }),
            ledger_sha256: ledgerFingerprint(recentSourceKeys),
          }
          claimed = await reserve.claim({ reserveDir, inputRoot: options.inputRoot, fingerprints, runId: process.env.DFE_PRESS_RUN_ID || runDir })
          context.preparedReserveClaimResult = { claimed: Boolean(claimed.claim), set_id: claimed.claim?.set.set_id || null, reason: claimed.reason || null, invalidated: claimed.invalidated || [] }
        } catch (error) {
          claimed = null
          context.preparedReserveClaimResult = { claimed: false, set_id: null, reason: 'reserve unavailable; fresh bounded intake', error: error.message, invalidated: [] }
        }
      }
      if (claimed?.claim) {
        try {
          context.signalHarvest = await mine({ claim: claimed.claim, notes: claimed.notes })
          context.reserveClaim = claimed.claim
          context.finalizeReserve = reserve.finalize
          context.remineWithoutReserve = () => mine(null)
        } catch (error) {
          // Settle the claim exactly once, then continue with fresh intake.
          let settled = null
          try { settled = await reserve.finalize(claimed.claim, { error }) } catch (finalizeError) { settled = { state: 'finalize-error', error: finalizeError.message } }
          context.preparedReserveClaimResult = { ...context.preparedReserveClaimResult, claimed: false, error: error.message, settled: settled?.state || null }
          context.signalHarvest = await mine(null)
        }
      } else {
        context.signalHarvest = await mine(null)
      }
      return {
        notes_scanned: context.signalHarvest.notes_scanned,
        notes_selected: context.signalHarvest.notes_selected.length,
        source_candidates: context.signalHarvest.source_candidates.length,
        diversity_avoid_terms: recentDiversityAvoidTerms,
        prepared_reserve: context.preparedReserveClaimResult || null,
        output: path.relative(root, path.join(runDir, 'signal-harvest.json')),
      }
    },
  }
}
