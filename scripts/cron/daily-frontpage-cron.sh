#!/usr/bin/env bash
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if ! python3 "$REPO/scripts/press-owner.py" --validate; then
  exec python3 "$REPO/scripts/press-owner.py" -- bash "$0" "$@"
fi
export CI=1
export NO_COLOR=1
if [[ -z "${SSH_AUTH_SOCK:-}" && -S "/var/run/com.apple.launchd.i0eNeSHWNZ/Listeners" ]]; then
  export SSH_AUTH_SOCK="/var/run/com.apple.launchd.i0eNeSHWNZ/Listeners"
fi

stage="Runtime verification"
log_dir="$REPO/tmp/cron-logs"
mkdir -p "$log_dir"
run_id="${DFE_PRESS_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
log_file="$log_dir/daily-frontpage-$run_id.log"
# Stage report artifacts in the dedicated profile cache; never weaken media policy.
report_cache="${DFE_REPORT_CACHE_DIR:-/Users/nickgeorge-studio/.hermes/profiles/frontpage/cache}"
screenshot_dir="$report_cache/images"
screenshot_file="$screenshot_dir/daily-frontpage-$run_id.png"
source_material_dir="$report_cache/images"
source_material_file="$source_material_dir/source-material-$run_id"
prompt_dir="$report_cache/documents"
prompt_file="$prompt_dir/scene-prompt-$run_id.txt"
fix_prompt_dir="$report_cache/documents"
fix_prompt_file="$fix_prompt_dir/daily-frontpage-fix-goal-$run_id.md"
cron_job_id="7d714808bf6f"

write_failure_goal_prompt() {
  local code="$1"
  mkdir -p "$fix_prompt_dir"
  cat > "$fix_prompt_file" <<EOF
# Goal: repair the failed Daily Frontpage cron run

You are Frank, curator/operator of the Daily Frontpage Engine for Nick.
The scheduled publish job failed. Do not stop at diagnosis while tools can still repair it.
Keep patching, testing, committing, pushing, rerunning the existing cron job, and verifying until the press is honestly green or a real external blocker remains.

## Failed run
- Cron job id: $cron_job_id
- Failed stage: $stage
- Exit code: $code
- Log: $log_file
- Repo: $REPO
- Cron worktree: $REPO/../hermes-frontpage-engine-cron

## Required operating manual
1. Load the daily-frontpage-engine and frontpage-press-hardening skills first.
2. Read the real cron log above and classify the incident with:
   npm run press:doctor -- --log $log_file --json
3. Inspect the failed run artifacts under the latest run dir named in the log, especially source-research, source-fidelity, scene prompt, QA output, and publish summary files.
4. Patch the real blocker. Do not bypass gates, fake source windows, or lower the 6-window standard.
5. Run focused tests for the touched edge, then npm run qa:publish from $REPO.
6. Commit and push code repairs to main.
7. Do not recursively trigger cron. Use the exact checkpoint and retained candidate.
   If already pushed, run bash scripts/cron/daily-frontpage-cron.sh --proof-only <checkpoint.json>.
   Never regenerate merely because remote/proof/report failed. For fidelity/mapping, retain the same source records and exact critique.
   Check for active daily-frontpage-cron, run-daily-publish-cron, or run-daily-process processes before starting another run. Do not overlap press runs.
8. Verify the final run with:
   - cron last_status: ok
   - remote_matches: true
   - npm run press:proof -- --log <green-log> --output tmp/publish-proof-check-<run>.json --adversarial-visual-qa pass
   - screenshot proof
   - live preload proof
   - adversarial visual QA of the screenshot
9. Pull the published edition back into the primary repo with git pull --ff-only origin main.
10. Report to Nick: failed stage, blocker, repair commits, verification output, edition id, and screenshot/source/prompt proof if available.

## Last log window
\`\`\`
$(tail -80 "$log_file" 2>/dev/null || true)
\`\`\`
EOF
}

report_fail() {
  local code="$1"
  write_failure_goal_prompt "$code" || true
  echo "Stage: $stage"
  echo
  echo "Error summary: command failed with exit code $code."
  echo "Log: $log_file"
  echo "Fix goal prompt: $fix_prompt_file"
  echo "MEDIA:$fix_prompt_file"
  echo
  echo "Last 80 log lines:"
  tail -80 "$log_file" 2>/dev/null || true
  echo
  echo "Next action: inspect the failed stage/checkpoint; repair the same candidate, or proof-only after publication. Do not recursively trigger cron."
  exit "$code"
}

run_stage() {
  stage="$1"
  shift
  {
    echo "===== $stage ====="
    echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"
  } >> "$log_file"
  "$@" >> "$log_file" 2>&1 || report_fail "$?"
}

cd "$REPO" || {
  stage="Runtime verification"
  {
    echo "===== Runtime verification ====="
    echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] cd $REPO"
    echo "cannot cd to $REPO"
  } >> "$log_file" 2>&1 || true
  report_fail 1
}

if [[ -f "$REPO/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  set +a
fi

capture_success_screenshot() {
  mkdir -p "$screenshot_dir"
  local expected_edition_id="${1:-}"
  node - "$screenshot_file" "$expected_edition_id" "$run_id" <<'NODE' >> "$log_file" 2>&1
const { chromium } = require('playwright');

const screenshotPath = process.argv[2];
const expectedEditionId = process.argv[3] || '';
const runId = process.argv[4] || Date.now().toString();
const baseUrl = 'https://daily.nockgarden.com/';
const url = `${baseUrl}?proof=${encodeURIComponent(runId)}${expectedEditionId ? `&edition=${encodeURIComponent(expectedEditionId)}` : ''}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
  const page = await context.newPage();
  let response = null;
  let proof = null;
  let lastMismatch = null;
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    response = await page.goto(`${url}&attempt=${attempt}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    try {
      await page.waitForSelector('.stage, [data-edition-id], main, body', { timeout: 30000 });
      await page.waitForSelector('img.plate', { timeout: 30000 });
      await page.waitForFunction(() => {
        const plate = document.querySelector('img.plate');
        return Boolean(plate && plate.complete && plate.naturalWidth > 100 && plate.naturalHeight > 100);
      }, null, { timeout: 120000 });
    } catch (error) {
      lastMismatch = `Live proof attempt ${attempt} did not load a readable plate yet: ${error && error.message ? error.message : error}`;
      console.log(lastMismatch);
      await page.evaluate(() => {
        try { window.localStorage?.clear(); window.sessionStorage?.clear(); } catch {}
      }).catch(() => {});
      await page.waitForTimeout(10000);
      continue;
    }
    await page.waitForTimeout(2000);
    proof = await page.evaluate(() => {
    const images = Array.from(document.images)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.currentSrc || img.src,
          className: String(img.className || ''),
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
        };
      })
      .filter((img) => img.src);
    const iframes = Array.from(document.querySelectorAll('iframe'))
      .map((frame) => {
        const rect = frame.getBoundingClientRect();
        return { src: frame.src || frame.getAttribute('src') || '', width: Math.round(rect.width), height: Math.round(rect.height) };
      })
      .filter((frame) => frame.src);
    const plateImages = images.filter((img) => img.className.includes('plate') || /\/assets\/plate\.(png|jpg|webp)$/i.test(img.src));
    const loadedImages = images.filter((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    const loadedPlateImages = plateImages.filter((img) => img.complete && img.naturalWidth > 100 && img.naturalHeight > 100);
    return {
      title: document.title,
      imageCount: images.length,
      loadedImageCount: loadedImages.length,
      plateImageCount: plateImages.length,
      loadedPlateImageCount: loadedPlateImages.length,
      plate: loadedPlateImages[0] || plateImages[0] || null,
      iframeCount: iframes.length,
      sampleIframes: iframes.slice(0, 6),
      stageSize: (() => {
        const stage = document.querySelector('.stage');
        if (!stage) return null;
        const rect = stage.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })()
    };
  });
    proof.expectedEditionId = expectedEditionId || null;
    proof.proofUrl = page.url();
    proof.attempt = attempt;
    const plateSrc = proof.plate?.src || '';
    const pageEditionId = await page.evaluate(() => document.querySelector('[data-edition-id]')?.getAttribute('data-edition-id') || document.body?.dataset?.editionId || null).catch(() => null);
    proof.pageEditionId = pageEditionId;
    if (!expectedEditionId || (plateSrc.includes(expectedEditionId) && pageEditionId === expectedEditionId)) {
      lastMismatch = null;
      break;
    }
    lastMismatch = `Live proof attempt ${attempt} showed plate=${plateSrc || 'none'} pageEditionId=${pageEditionId || 'none'} expected=${expectedEditionId}`;
    console.log(lastMismatch);
    await page.evaluate(() => {
      try { window.localStorage?.clear(); window.sessionStorage?.clear(); } catch {}
    }).catch(() => {});
    await page.waitForTimeout(10000);
  }
  if (!response || !response.ok()) throw new Error(`Live page responded with ${response ? response.status() : 'no response'}`);
  if (!proof.plateImageCount) throw new Error('Live page loaded, but the current plate image was not detected.');
  if (!proof.loadedPlateImageCount) throw new Error(`Live page detected a plate image but it was not loaded: ${JSON.stringify(proof.plate)}`);
  if (lastMismatch) throw new Error(`Live proof captured stale edition after retries: ${lastMismatch}`);
  if (proof.imageCount && proof.loadedImageCount < Math.min(2, proof.imageCount)) throw new Error(`Only ${proof.loadedImageCount}/${proof.imageCount} images loaded.`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await context.close();
  await browser.close();
  console.log(`Captured success screenshot: ${screenshotPath}`);
  console.log(`Live preload proof: ${JSON.stringify(proof)}`);
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
NODE
}

print_research_approach() {
  local edition_dir="$1"
  node - "$edition_dir/source-research.json" "$edition_dir/visual-direction.json" <<'NODE'
const fs = require('fs');
const [sourcePath, visualPath] = process.argv.slice(2);
const readJson = (path) => fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
const source = readJson(sourcePath) || {};
const visual = readJson(visualPath) || {};
const autoresearch = source.autoresearch || {};
const anchor = source.anchor_research?.anchor_source || {};
const clusters = Array.isArray(autoresearch.clusters) ? autoresearch.clusters : [];
const urls = Array.isArray(autoresearch.selected_content_urls) ? autoresearch.selected_content_urls : [];
const imageMaterial = findFirstArray(source, 'selected_image_material') || [];
console.log('Research approach:');
console.log(`- Mode: ${source.research_mode || autoresearch.tool || 'not recorded'}`);
if (anchor.title || anchor.url) console.log(`- Anchor: ${anchor.title || anchor.url}${anchor.url ? ` — ${anchor.url}` : ''}`);
if (autoresearch.workflow) console.log(`- Method: ${autoresearch.workflow}`);
if (source.editorial_bias?.mode) console.log(`- Bias: ${source.editorial_bias.mode}; preferred ${joinShort(source.editorial_bias.preferred_domains)}`);
if (clusters[0]?.takeaway) console.log(`- Thesis: ${clusters[0].takeaway}`);
console.log(`- Source field: ${urls.length || 'unknown'} selected URLs; ${imageMaterial.length || autoresearch.selected_image_material_count || 0} image-material candidates.`);
if (visual.composition_archetype || visual.camera_plate_grammar || visual.plate_posture?.plate_posture) {
  console.log(`- Plate grammar: ${[visual.plate_posture?.plate_posture, visual.composition_archetype, visual.camera_plate_grammar].filter(Boolean).join(' / ')}`);
}
function joinShort(value) {
  return Array.isArray(value) && value.length ? value.slice(0, 7).join(', ') : 'not recorded';
}
function findFirstArray(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstArray(item, key);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(obj[key])) return obj[key];
  for (const value of Object.values(obj)) {
    const found = findFirstArray(value, key);
    if (found) return found;
  }
  return null;
}
NODE
}

prepare_source_material_image() {
  local edition_dir="$1"
  mkdir -p "$source_material_dir"
  local source_infos
  source_infos="$(node - "$edition_dir/source-research.json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
if (!fs.existsSync(path)) process.exit(0);
const source = JSON.parse(fs.readFileSync(path, 'utf8'));
const material = findFirstArray(source, 'selected_image_material') || [];
const useful = material.filter(item => item && item.image_url && !/favicon|logo|avatar|profile/i.test(`${item.image_url} ${item.caption || ''} ${item.title || ''}`));
let candidates = useful.length ? useful : material.filter(item => item && item.image_url);
if (!candidates.length) {
  const fallback = source.visual_reference || source.autoresearch?.visual_reference || source.anchor_research?.anchor_source || null;
  if (fallback?.image_url) {
    candidates = [{
      image_url: fallback.image_url,
      page_url: fallback.source_url || fallback.final_url || fallback.url || '',
      caption: fallback.title || fallback.caption || 'anchor visual reference',
      lineage: 'visual_reference_fallback',
      visual_reason: fallback.selection_reason || 'No selected_image_material survived; reporting the image-bearing anchor/visual reference instead.'
    }];
  }
}
for (const item of candidates) {
  console.log(JSON.stringify({
    image_url: item.image_url,
    page_url: item.page_url || '',
    caption: item.caption || item.title || '',
    lineage: item.lineage || '',
    visual_reason: item.visual_reason || ''
  }));
}
function findFirstArray(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstArray(item, key);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(obj[key])) return obj[key];
  for (const value of Object.values(obj)) {
    const found = findFirstArray(value, key);
    if (found) return found;
  }
  return null;
}
NODE
)"
  if [[ -z "$source_infos" ]]; then
    echo "Source material image: not detected"
    return 0
  fi

  local image_url page_url caption lineage visual_reason source_info
  local tmp_file content_type extension downloaded
  tmp_file="$source_material_file.download"
  downloaded=0
  while IFS= read -r source_info; do
    [[ -z "$source_info" ]] && continue
    image_url="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(v.image_url)' "$source_info")"
    page_url="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(v.page_url)' "$source_info")"
    caption="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(v.caption)' "$source_info")"
    lineage="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(v.lineage)' "$source_info")"
    visual_reason="$(node -e 'const v=JSON.parse(process.argv[1]); console.log(v.visual_reason)' "$source_info")"
    if curl -L --fail --silent --show-error --max-time 60 --output "$tmp_file" "$image_url" >> "$log_file" 2>&1; then
      downloaded=1
      break
    fi
    echo "Source material candidate failed: $image_url" >> "$log_file"
    rm -f "$tmp_file"
  done <<< "$source_infos"

  if [[ "$downloaded" != "1" ]]; then
    echo "Source material image: ${image_url:-not detected}"
    echo "Source material page: ${page_url:-not recorded}"
    echo "Source material download: failed for all candidates; see log"
    rm -f "$tmp_file"
    return 0
  fi
  content_type="$(file --brief --mime-type "$tmp_file" 2>/dev/null || true)"
  case "$content_type" in
    image/png) extension="png" ;;
    image/jpeg) extension="jpg" ;;
    image/webp) extension="webp" ;;
    image/gif) extension="gif" ;;
    *) extension="img" ;;
  esac
  mv "$tmp_file" "$source_material_file.$extension"
  if [[ "$lineage" == "visual_reference_fallback" ]]; then
    echo "Anchor visual reference image: $image_url"
    echo "Anchor visual reference note: fallback only — no dominant source-image plate seed survived for this run"
  else
    echo "Source material image: $image_url"
  fi
  echo "Source material page: ${page_url:-not recorded}"
  [[ -n "$caption" ]] && echo "Source material caption: $caption"
  [[ -n "$lineage" ]] && echo "Source material lineage: $lineage"
  [[ -n "$visual_reason" ]] && echo "Source material reason: $visual_reason"
  echo "Source material file: $source_material_file.$extension"
  echo "MEDIA:$source_material_file.$extension"
}

print_scene_prompt() {
  local edition_dir="$1"
  if [[ ! -f "$edition_dir/scene-prompt.txt" ]]; then
    echo "Actual plate prompt: not detected"
    return 0
  fi
  mkdir -p "$prompt_dir"
  cp "$edition_dir/scene-prompt.txt" "$prompt_file"
  echo "Actual plate prompt: $prompt_file"
  echo "MEDIA:$prompt_file"
}

print_press_verdicts() {
  local edition_dir="$1"
  node - "$edition_dir" "$log_file" <<'NODE'
const fs = require('fs');
const path = require('path');
const [editionDir, logPath] = process.argv.slice(2);
const readJson = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const source = readJson(path.join(editionDir, 'source-research.json')) || {};
const fidelity = readJson(path.join(editionDir, 'source-fidelity-audit.json')) || {};
const pkg = readJson(path.join(editionDir, 'edition-package-summary.json')) || {};
const summary = lastJsonObject(fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '') || {};
const sourceWindowCount = Number(pkg.artifact_count || pkg.source_window_count || 0) || 'not recorded';
const sourceImageMode = source.source_image_mode || fidelity.source_image_mode || fidelity.inspection_mode || 'not recorded';
const fidelityVerdict = fidelity.gate_applicable === false || fidelity.verdict === 'skipped'
  ? `skipped (${sourceImageMode}) — not a pass`
  : `${fidelity.verdict || 'not recorded'}${fidelity.pass === false ? ` — blockers: ${(fidelity.blockers || []).join('; ')}` : ''}`;
const editorial = source.source_material_verdict || {};
console.log('Verdicts:');
console.log(`- Press/runtime: ${summary.ok ? 'green' : 'check log'} — daily:publish:cron completed${sourceWindowCount ? `; source windows ${sourceWindowCount}` : ''}`);
console.log(`- Publish/remote: ${summary.remote_matches ? 'green' : 'not verified'} — remote_matches: ${summary.remote_matches === true}`);
console.log('- Media/preload: loaded plate captured; provider playback and independent review still require their own evidence.');
console.log(`- Source-window: ${summary.proof_only ? 'proof-only: no fresh QA or generation claimed' : 'qa:publish passed'}; window count: ${sourceWindowCount}`);
console.log(`- Source-image fidelity: ${fidelityVerdict}`);
console.log(`- Overcopy: ${fidelity.transformation_score !== undefined ? (fidelity.pass ? 'green' : 'blocked') : 'not applicable in source-field mode'}${fidelity.transformation_score !== undefined ? ` — transformation_score: ${fidelity.transformation_score}` : ''}`);
console.log(`- Editorial/source-material: ${editorial.valid_dominant_source_image ? 'source-image mode' : 'source-field mode'} — ${source.source_image_mode_reason || 'not recorded'}`);
console.log('- Proof/report: attachments reported below; not an independent visual or actual-provider playback verdict.');
function lastJsonObject(text) {
  const marker = '{\n  "ok"';
  const start = text.lastIndexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
NODE
}

run_stage "Runtime verification" bash -lc 'pwd && node --version && npm --version'
run_stage "check:setup" npm run check:setup
if [[ ( "${1:-}" == "--proof-only" || "${1:-}" == "--resume-candidate" ) && -n "${2:-}" && "$#" == 2 ]]; then
  run_stage "daily:publish:cron $1" npm run daily:publish:cron -- "$1" "$2"
elif [[ "$#" == 0 ]]; then
  run_stage "daily:publish:cron" npm run daily:publish:cron
else
  stage="argument validation"
  report_fail 2
fi
expected_edition_id="$(node - "$log_file" <<'NODE'
const fs = require('fs');
const text = fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : '';
const marker = '{\n  "ok"';
const start = text.lastIndexOf(marker);
if (start >= 0) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const summary = JSON.parse(text.slice(start, i + 1));
          if (summary.local_edition_id) console.log(summary.local_edition_id);
        } catch {}
        break;
      }
    }
  }
}
NODE
)"
stage="success screenshot"
[[ -n "$expected_edition_id" ]] || report_fail 1
capture_success_screenshot "$expected_edition_id" || report_fail "$?"

# Cron generation names are opaque; use this publication's recorded run path.
latest_edition="$(node - "$log_file" <<'NODE'
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const lines = text.split('\n').filter(line => line.trim().startsWith('"latest_run_dir":'));
const lastLine = lines.at(-1) || '';
const value = lastLine.slice(lastLine.indexOf(':') + 1).trim().replace(/,$/, '');
const dir = value ? JSON.parse(value) : '';
if (dir && fs.existsSync(dir + '/edition-package-summary.json')) console.log(dir);
NODE
)"

if [[ -n "$latest_edition" ]]; then
  research_report="$(print_research_approach "$latest_edition")"
  source_material_report="$(prepare_source_material_image "$latest_edition")"
  prompt_report="$(print_scene_prompt "$latest_edition")"
  verdict_report="$(print_press_verdicts "$latest_edition")"
else
  research_report="Research approach: not detected — no latest edition directory found."
  source_material_report="Source material image: not detected — no latest edition directory found."
  prompt_report="Actual plate prompt: not detected — no latest edition directory found."
  verdict_report="Verdicts: not detected — no latest edition directory found."
fi

echo "Publication evidence collected (see exact checkpoint for generation versus proof-only mode)."
echo
echo "Stages passed:"
echo "- Runtime verification"
echo "- check:setup"
echo "- daily:publish:cron"
echo
echo "Edition: ${latest_edition:-not detected in tmp/daily-process-runs}"
echo "Screenshot: $screenshot_file"
echo "MEDIA:$screenshot_file"
echo "$source_material_report"
echo
echo "$research_report"
echo
echo "$prompt_report"
echo
echo "$verdict_report"
echo
echo "Log: $log_file"
echo "Live: https://daily.nockgarden.com/"
