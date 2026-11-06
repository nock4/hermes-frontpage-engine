import fs from 'node:fs/promises'
import path from 'node:path'
import { auditSourceImageFidelity } from '../../scripts/lib/source-fidelity-audit.mjs'

// Legacy unit tests isolate resemblance/debug/overcopy prose, NOT transformation
// vision. Explicit SYNTHETIC fulfilled findings keep that independent axis valid.
// Never use this fixture adapter for production or the new clause-gate tests.
export async function auditWithSyntheticFulfilledTransformations(args, dir, dependencies) {
  const source = args.payload?.source_image_fingerprints?.find(row => row.image_url)
  if (!source) return auditSourceImageFidelity(args, dir, dependencies)
  const platePath = path.join(dir, 'synthetic-prose-test-plate.png')
  await fs.writeFile(platePath, 'SYNTHETIC UNIT TEST PLATE, NOT VISION EVIDENCE')
  const payload = { ...args.payload, source_contract: { mode: 'source-image', dominant_source_image_url: source.image_url, must_transform: ['SYNTHETIC test clause: use distinct separated material forms.'] } }
  return auditSourceImageFidelity({ ...args, payload, platePath }, dir, {
    ...dependencies,
    openAiJsonImpl: async request => {
      const raw = await dependencies.openAiJsonImpl(request)
      const prompt = JSON.parse(request.input[0].content[0].text)
      return { ...raw, transformation_context_id: prompt.transformation_context_id, transformation_findings: prompt.required_transformations.map(row => ({ ...row, status: 'fulfilled', visible_evidence: 'SYNTHETIC fixture: separated form at right.', context: 'SYNTHETIC isolated prose-test context.', reason: 'SYNTHETIC fulfilled fixture; no actual visual claim.' })) }
    },
  })
}
