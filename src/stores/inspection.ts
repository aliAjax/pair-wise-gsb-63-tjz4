import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedRecords, seedReleases, seedZones } from '../data/seed'
import { createOfflineInspection } from '../services/api'
import type {
  AuditEntry,
  CircuitState,
  InspectionDraft,
  InspectionRecord,
  InspectionStatus,
  InterlockZone,
  OfflineBatch,
  OfflineBatchEntry,
  ZoneRelease
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform'
const SCHEMA_VERSION = 2

interface PersistedState {
  schema?: number
  records: InspectionRecord[]
  audit: AuditEntry[]
  zones?: InterlockZone[]
  releases?: ZoneRelease[]
  batches?: OfflineBatch[]
}

function readPersisted(): Required<PersistedState> {
  const fallback = {
    schema: SCHEMA_VERSION,
    records: structuredClone(seedRecords),
    audit: structuredClone(seedAudit),
    zones: structuredClone(seedZones),
    releases: structuredClone(seedReleases),
    batches: [] as OfflineBatch[]
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const persisted = JSON.parse(raw) as PersistedState
    return {
      schema: SCHEMA_VERSION,
      records: (persisted.records ?? fallback.records).map((record) => ({ ...record, zoneId: record.zoneId ?? null })),
      audit: persisted.audit ?? fallback.audit,
      zones: persisted.zones ?? fallback.zones,
      releases: persisted.releases ?? fallback.releases,
      batches: persisted.batches ?? []
    }
  } catch {
    return fallback
  }
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const zones = ref<InterlockZone[]>(initial.zones)
  const releases = ref<ZoneRelease[]>(initial.releases)
  const batches = ref<OfflineBatch[]>(initial.batches)
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < '2026-09-29' && !['已关闭'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length,
    zonesHeld: zones.value.filter((zone) => zoneConclusion(zone.id) !== '已放行').length
  }))

  const pendingRecords = computed(() => records.value.filter((record) => record.backfillStatus === '待核'))

  // —— 分区结论：唯一数据源，总览/看板/审计都从这里读 ——

  function activeRelease(zoneId: string): ZoneRelease | undefined {
    return releases.value.find((release) => release.zoneId === zoneId && release.status !== '已作废')
  }

  function releasesFor(zoneId: string): ZoneRelease[] {
    return releases.value.filter((release) => release.zoneId === zoneId).sort((a, b) => b.version - a.version)
  }

  function zoneConclusion(zoneId: string | null): string {
    if (!zoneId) return '待核'
    const zone = zones.value.find((item) => item.id === zoneId)
    if (!zone) return '待核'
    if (zone.circuitState === '断开检修') return '回路断开·全线停用'
    return activeRelease(zoneId)?.status ?? '待复测'
  }

  function canReopen(record: InspectionRecord): boolean {
    return zoneConclusion(record.zoneId) === '已放行'
  }

  // 回路状态一变化，分区放行立即作废重算
  function invalidateAndRecompute(zoneId: string, reason: string) {
    const now = new Date().toISOString()
    const current = activeRelease(zoneId)
    if (current) {
      current.status = '已作废'
      current.invalidatedBy = reason
      current.updatedAt = now
    }
    const version = (current?.version ?? 0) + 1
    releases.value.unshift({
      id: `REL-${zoneId}-V${version}`,
      zoneId,
      status: '待复测',
      retestDone: false,
      leaderConfirmed: false,
      leader: '',
      basis: `${reason}，原放行作废，需重新复测并由值班长确认`,
      invalidatedBy: '',
      version,
      createdAt: now,
      updatedAt: now
    })
    addAudit(zoneId, '分区放行作废重算', '系统联锁', current ? `${current.id} 作废，生成 REL-${zoneId}-V${version}（待复测）：${reason}` : `生成 REL-${zoneId}-V${version}（待复测）：${reason}`)
  }

  function setCircuitState(zoneId: string, next: CircuitState, operator = '检修调度') {
    const zone = zones.value.find((item) => item.id === zoneId)
    if (!zone || zone.circuitState === next) return { ok: false, message: '回路状态未变化' }
    const prev = zone.circuitState
    zone.circuitState = next
    zone.circuitUpdatedAt = new Date().toISOString()
    addAudit(zoneId, `回路状态变更：${next}`, operator, `${zone.name}由${prev}切换为${next}`)
    invalidateAndRecompute(zoneId, `回路状态变更：${prev}→${next}`)
    if (next === '断开检修') {
      records.value.filter((record) => record.zoneId === zoneId && !record.stopped).forEach((record) => {
        record.stopped = true
        record.updatedAt = new Date().toISOString()
        addAudit(record.id, '联动停用', '系统联锁', `${zone.name}断开检修，${record.deviceName}全线停用`)
      })
    }
    return { ok: true, message: `${zone.name}已切换为${next}，分区放行已作废重算` }
  }

  // 分区复测：单台通过不算数，须回路接通且分区内无未闭环异常项
  function completeZoneRetest(zoneId: string, operator = '当前用户') {
    const zone = zones.value.find((item) => item.id === zoneId)
    const release = activeRelease(zoneId)
    if (!zone || !release) return { ok: false, message: '分区不存在' }
    if (zone.circuitState !== '接通') return { ok: false, message: '回路断开检修中，无法组织分区复测' }
    const abnormal = records.value.filter((record) => record.zoneId === zoneId && record.status !== '已关闭' && record.items.some((item) => item.result === '异常'))
    if (abnormal.length) return { ok: false, message: `${abnormal.map((record) => record.deviceName).join('、')}仍有异常项，分区复测不通过` }
    release.retestDone = true
    release.status = '待值班长确认'
    release.version += 1
    release.updatedAt = new Date().toISOString()
    addAudit(zoneId, '分区复测完成', operator, `${zone.name}复测通过，待值班长确认`)
    return { ok: true, message: '分区复测已通过，待值班长确认' }
  }

  function confirmZoneLeader(zoneId: string, leader: string) {
    const zone = zones.value.find((item) => item.id === zoneId)
    const release = activeRelease(zoneId)
    if (!zone || !release) return { ok: false, message: '分区不存在' }
    if (!release.retestDone) return { ok: false, message: '分区复测未完成，值班长不能确认' }
    release.leaderConfirmed = true
    release.leader = leader
    release.status = '已放行'
    release.version += 1
    release.updatedAt = new Date().toISOString()
    addAudit(zoneId, '值班长确认放行', leader, `${zone.name}复测与确认齐全，分区恢复开放`)
    return { ok: true, message: `${zone.name}已恢复开放` }
  }

  // 缺陷处置牵动分区结论：已放行分区内出现异常项，放行立即作废重算
  function syncZoneByRecord(record: InspectionRecord) {
    if (!record.zoneId) return
    const release = activeRelease(record.zoneId)
    if (!release || release.status !== '已放行') return
    if (record.status !== '已关闭' && record.items.some((item) => item.result === '异常')) {
      invalidateAndRecompute(record.zoneId, `缺陷处置触发：${record.deviceName}存在异常项`)
    }
  }

  // —— 旧数据分区回填：缺分区号按设备关联回填，补不全的停在待核 ——

  function backfillLegacyZones(includePending = false) {
    let filled = 0
    let pending = 0
    for (const record of records.value) {
      if (record.zoneId) continue
      if (!includePending && record.backfillStatus !== undefined) continue
      const zone = zones.value.find((item) => item.deviceCodes.includes(record.deviceCode))
      if (zone) {
        record.zoneId = zone.id
        record.backfillStatus = '已回填'
        filled += 1
        addAudit(record.id, '旧数据分区回填', '系统迁移', `按设备 ${record.deviceCode} 关联回填至 ${zone.name}`)
      } else {
        record.backfillStatus = '待核'
        pending += 1
        addAudit(record.id, '分区待核', '系统迁移', `设备 ${record.deviceCode} 未登记联锁分区，停在待核`)
      }
    }
    return { filled, pending }
  }

  // —— 离线补录：按批次入库，分区结论冲突保留两版 ——

  function importOfflineBatch(source: string, entries: OfflineBatchEntry[]) {
    const now = new Date().toISOString()
    const batch: OfflineBatch = { id: `BATCH-${Date.now().toString().slice(-8)}`, source, importedAt: now, results: [], conflicts: [] }
    for (const entry of entries) {
      const record = records.value.find((item) => item.id === entry.recordId)
      let zoneId = entry.zoneId ?? record?.zoneId ?? null
      if (!zoneId && record) {
        const zone = zones.value.find((item) => item.deviceCodes.includes(record.deviceCode))
        if (zone) {
          zoneId = zone.id
          record.zoneId = zone.id
          record.backfillStatus = '已回填'
          addAudit(record.id, '旧数据分区回填', '系统迁移', `补录批次按设备 ${record.deviceCode} 关联回填至 ${zone.name}`)
        }
      }
      if (!zoneId) {
        if (record) record.backfillStatus = '待核'
        batch.results.push({ entry, result: '待核', note: '缺少分区号且设备无关联，停在待核' })
        continue
      }
      const release = activeRelease(zoneId)
      const localConclusion = release?.status ?? '待复测'
      if (localConclusion !== entry.conclusion) {
        const conflict = {
          id: `${batch.id}-${entry.recordId}`,
          zoneId,
          recordId: entry.recordId,
          localConclusion,
          incomingConclusion: entry.conclusion,
          resolution: '双版保留' as const,
          createdAt: now
        }
        batch.conflicts.push(conflict)
        batch.results.push({ entry, result: '冲突双版保留', note: `本地结论「${localConclusion}」与补录结论「${entry.conclusion}」不一致，两版均保留待裁决` })
        addAudit(zoneId, '分区结论冲突·双版保留', entry.operator, `批次 ${batch.id}：本地「${localConclusion}」/ 补录「${entry.conclusion}」，两版均保留`)
        continue
      }
      if (release) {
        release.retestDone = release.retestDone || entry.retestDone
        if (entry.leaderConfirmed && release.retestDone) {
          release.leaderConfirmed = true
          release.leader = release.leader || entry.operator
          release.status = '已放行'
        }
        release.updatedAt = now
      }
      batch.results.push({ entry, result: '已入库', note: `与本地分区结论「${localConclusion}」一致，已合并` })
    }
    batches.value.unshift(batch)
    addAudit(batch.id, '离线补录批次入库', source, `共 ${entries.length} 条：入库 ${batch.results.filter((item) => item.result === '已入库').length} 条，冲突双版保留 ${batch.conflicts.length} 条，待核 ${batch.results.filter((item) => item.result === '待核').length} 条`)
    return batch
  }

  // —— 检验记录 ——

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft)
    const zone = zones.value.find((item) => item.deviceCodes.includes(record.deviceCode))
    if (zone) {
      record.zoneId = zone.id
      record.backfillStatus = '已回填'
    } else {
      record.backfillStatus = '待核'
    }
    records.value.unshift(record)
    addAudit(record.id, '创建检验记录', draft.inspector, zone ? `新建设备班次检验任务，关联${zone.name}` : '新建设备班次检验任务，设备未登记联锁分区，停在待核')
    return record
  }

  function updateRecord(id: string, patch: Partial<InspectionRecord>, action = '保存检验记录') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return
    Object.assign(record, patch, { version: record.version + 1, updatedAt: new Date().toISOString() })
    addAudit(id, action, '当前用户', `记录更新至版本 V${record.version}`)
    syncZoneByRecord(record)
  }

  function transition(id: string, next: InspectionStatus, detail: string) {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (next === '已关闭' && record.items.some((item) => item.result === '异常')) {
      return { ok: false, message: '仍有异常项，不能关闭任务' }
    }
    if (next === '待复测' && !record.stopped && record.risk === '紧急') {
      return { ok: false, message: '紧急风险缺陷必须先执行停用' }
    }
    record.status = next
    record.version += 1
    record.updatedAt = new Date().toISOString()
    addAudit(id, `状态流转：${next}`, '当前用户', detail)
    syncZoneByRecord(record)
    return { ok: true, message: `已流转至${next}` }
  }

  function addAudit(recordId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({
      id: `${recordId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      recordId,
      action,
      operator,
      detail,
      createdAt: new Date().toISOString()
    })
  }

  function resetDemo() {
    records.value = structuredClone(seedRecords)
    audit.value = structuredClone(seedAudit)
    zones.value = structuredClone(seedZones)
    releases.value = structuredClone(seedReleases)
    batches.value = []
    backfillLegacyZones()
  }

  backfillLegacyZones()

  watch([records, audit, zones, releases, batches], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schema: SCHEMA_VERSION,
      records: records.value,
      audit: audit.value,
      zones: zones.value,
      releases: releases.value,
      batches: batches.value
    }))
  }, { deep: true })

  return {
    records, audit, zones, releases, batches, keyword, status, area, liveMessage,
    filtered, stats, pendingRecords,
    activeRelease, releasesFor, zoneConclusion, canReopen,
    setCircuitState, completeZoneRetest, confirmZoneLeader,
    backfillLegacyZones, importOfflineBatch,
    addRecord, updateRecord, transition, resetDemo
  }
})
