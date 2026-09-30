import { it, expect } from 'vitest'
import { assertRunEditionProvenance } from '../../scripts/run-daily-publish-cron.mjs'
it('requires exact run package and binding edition identity',()=>{
 expect(()=>assertRunEditionProvenance('2026-09-30-art-v1',{edition_id:'2026-09-30-art-v1'},{source_binding_set_id:'bindings-2026-09-30-art-v1'})).not.toThrow()
 expect(()=>assertRunEditionProvenance('2026-09-30-art-v1',{edition_id:'2026-09-29-old-v1'},{source_binding_set_id:'bindings-2026-09-30-art-v1'})).toThrow()
 expect(()=>assertRunEditionProvenance('2026-09-30-art-v1',{},{})).toThrow()
})
