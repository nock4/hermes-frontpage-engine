import { describe, it, expect } from 'vitest'
import { buildAttestation, evaluateDelivery } from '../../scripts/delivery-attestation.mjs'
const now = new Date('2026-10-21T11:20:00Z')
const receipt = {target:'telegram:private',date:'2026-10-21',type:'edition',status:'sent',receipt:{success:true,platform:'telegram',chat_id:'private',message_id:123},text:'/private SECRET'}
const make = (records=[], time=now) => buildAttestation({now:time,records,accepted:true})
describe('nonsecret delivery attestation',()=>{
 it('allowlists fields and excludes diagnostic receipts',()=>{const a=make([receipt,{...receipt,type:'diagnostic'}]);expect(a.receipts).toEqual([{type:'edition',status:'sent'}]);expect(JSON.stringify(a)).not.toMatch(/private|SECRET|message_id|chat_id/)} )
 it('rejects a receipt for a different target',()=>expect(make([{...receipt,receipt:{...receipt.receipt,chat_id:'wrong'}}]).receipts[0].status).toBe('uncertain'))
 it('does not promote malformed receipts',()=>expect(make([{...receipt,receipt:null}]).receipts[0].status).toBe('uncertain'))
 it('distinguishes absent, stale, fresh missing and uncertain',()=>{
  expect(evaluateDelivery(null,{now}).reason).toBe('no-heartbeat')
  expect(evaluateDelivery(make([],new Date('2026-10-21T10:00:00Z')),{now}).reason).toBe('stale-heartbeat')
  expect(evaluateDelivery(make(),{now}).reason).toBe('receipt-absent')
  expect(evaluateDelivery(make([{...receipt,status:'pending'}]),{now}).reason).toBe('send-uncertain')
 })
 it('current accepted proof never substitutes for delivery',()=>expect(evaluateDelivery(make(),{now}).status).toBe('unavailable'))
 it('daily sent survives stale heartbeat but not uncertain recovery',()=>{
  expect(evaluateDelivery(make([receipt],new Date('2026-10-21T10:00:00Z')),{now}).status).toBe('delivered')
  expect(evaluateDelivery(make([receipt,{...receipt,type:'recovery',status:'uncertain'}]),{now}).status).toBe('unavailable')
 })
 it('rejects future, invalid, previous day and private injected fields',()=>{
  for(const a of [{...make(),heartbeat_at:'bogus'},{...make(),heartbeat_at:'2027-01-01T00:00:00Z'},{...make(),private:'SECRET'}]) expect(evaluateDelivery(a,{now}).reason).toBe('invalid-heartbeat')
  expect(evaluateDelivery(make([receipt],new Date('2026-10-20T11:20:00Z')),{now}).status).toBe('unavailable')
 })
 it('retains observed heartbeat even when rollout suppresses alerts',()=>{
  const time=new Date('2026-10-20T15:00:00Z')
  expect(evaluateDelivery(make([],time),{now:time})).toMatchObject({status:'before-rollout',heartbeat:'fresh',reason:'receipt-absent'})
 })
 it('uses Eastern deadline through DST and rollout cutoff',()=>{
  for(const time of ['2026-10-21T10:59:00Z','2026-11-01T11:59:00Z']) expect(evaluateDelivery(null,{now:new Date(time)}).status).toBe('before-deadline')
  expect(evaluateDelivery(null,{now:new Date('2026-11-01T12:00:00Z')}).status).toBe('unavailable')
  expect(evaluateDelivery(null,{now:new Date('2026-10-20T16:00:00Z')}).status).toBe('before-rollout')
 })
})
