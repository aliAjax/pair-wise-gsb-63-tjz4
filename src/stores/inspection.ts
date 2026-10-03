import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { sampleOfflineBatch, seedAudit, seedRecords, seedZones } from '../data/seed'
import { createOfflineInspection } from '../services/api'
import type {
  AuditEntry,
  CircuitStatus,
  DeviceRelease,
  InspectionDraft,
  InspectionRecord,
  InspectionStatus,
  InterlockZone,
  OfflineBatch,
  OfflineBatchInput,
  ZoneConclusionStatus,
  ZoneSummary
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform'

interface PersistedState {
  records: InspectionRecord[]
  audit: AuditEntry[]
  zones: InterlockZone[]
  batches: OfflineBatch[]
}

function readPersisted(): PersistedState {
  const fallback = () => ({
    records: structuredClone(seedRecords),
    audit: structuredClone(seedAudit),
    zones: structuredClone(seedZones),
    batches: [] as OfflineBatch[]
  })
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback()
    const parsed = JSON.parse(raw)
    return {
      records: parsed.records ?? seedRecords,
      audit: parsed.audit ?? seedAudit,
      zones: parsed.zones ?? structuredClone(seedZones),
      batches: parsed.batches ?? []
    }
  } catch {
    return fallback()
  }
}

let auditSeq = 0

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const zones = ref<InterlockZone[]>(initial.zones)
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

  const pendingRecords = computed(() => records.value.filter((item) => item.zonePending))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < '2026-09-29' && !['已关闭'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length,
    pendingZone: pendingRecords.value.length
  }))

  function findZone(id?: string) {
    return zones.value.find((zone) => zone.id === id)
  }

  /** 分区放行结论：回路、缺陷、复测、值班长确认实时重算，各视图共用这一条结果 */
  function summarizeZone(zone: InterlockZone): ZoneSummary {
    const members = records.value.filter((item) => item.zoneId === zone.id)
    const openDefects = members.filter((item) => item.status !== '已关闭')
    let status: ZoneSummary['status']
    let basis: string
    if (zone.circuitStatus !== '接通') {
      status = '回路中断'
      basis = `回路 ${zone.circuit} 处于${zone.circuitStatus}，分区放行无效`
    } else if (openDefects.length) {
      status = '缺陷未闭环'
      basis = `${openDefects.length} 台设备检验任务未闭环`
    } else if (!zone.retestPassedAt) {
      status = '待分区复测'
      basis = '回路恢复后尚未完成分区复测'
    } else if (!zone.leaderConfirmedAt) {
      status = '待值班长确认'
      basis = '分区复测已通过，等待值班长确认'
    } else {
      status = '已放行'
      basis = '分区复测与值班长确认齐全，恢复开放'
    }
    return { zone, members, openDefects, status, basis, released: status === '已放行' }
  }

  const zoneSummaries = computed(() => zones.value.map(summarizeZone))

  function getZoneSummary(zoneId?: string) {
    return zoneSummaries.value.find((summary) => summary.zone.id === zoneId)
  }

  /** 单台通过不能先开放：设备放行以分区结论为准 */
  function deviceRelease(record: InspectionRecord): DeviceRelease {
    if (record.zonePending || !record.zoneId || !findZone(record.zoneId)) {
      return { released: false, label: '分区待核', reason: '记录缺少分区归属，核实前不得开放' }
    }
    const summary = getZoneSummary(record.zoneId)!
    if (record.stopped) {
      return { released: false, label: '停用隔离', reason: summary.released ? '分区已放行，可解除停用隔离' : `设备停用隔离，且${summary.basis}` }
    }
    if (record.status !== '已关闭') {
      return { released: false, label: '任务未闭环', reason: `检验任务处于${record.status}` }
    }
    if (!summary.released) {
      return { released: false, label: '分区未放行', reason: summary.basis }
    }
    return { released: true, label: '分区已放行', reason: summary.basis }
  }

  function pushConclusion(zone: InterlockZone, statusValue: ZoneConclusionStatus, basis: string, source: '系统重算' | '离线补录', batchId?: string, conflict = false) {
    zone.releaseVersion += 1
    zone.conclusions.unshift({
      id: `${zone.id}-C${zone.releaseVersion}`,
      zoneId: zone.id,
      version: zone.releaseVersion,
      status: statusValue,
      basis,
      source,
      batchId,
      conflict,
      createdAt: new Date().toISOString()
    })
  }

  /** 分区内出现新缺陷或停用时，已取得的复测/确认作废并重算 */
  function invalidateZoneForRecord(record: InspectionRecord, reason: string) {
    if (!record.zoneId) return
    const zone = findZone(record.zoneId)
    if (!zone || (!zone.retestPassedAt && !zone.leaderConfirmedAt)) return
    zone.retestPassedAt = null
    zone.retestBy = null
    zone.leaderConfirmedAt = null
    zone.leaderConfirmedBy = null
    const after = summarizeZone(zone)
    pushConclusion(zone, after.status, `${reason}，分区复测与确认作废重算`, '系统重算')
    addAudit(zone.id, '分区放行重算', '系统', `${reason}：${zone.name} 复测与确认作废，现行结论「${after.status}」`)
  }

  /** 回路状态一变化，分区放行立即作废重算 */
  function setCircuitStatus(zoneId: string, next: CircuitStatus, operator = '当前用户') {
    const zone = findZone(zoneId)
    if (!zone) return { ok: false, message: '分区不存在' }
    if (zone.circuitStatus === next) return { ok: false, message: '回路状态未变化' }
    const previous = zone.circuitStatus
    zone.circuitStatus = next
    zone.retestPassedAt = null
    zone.retestBy = null
    zone.leaderConfirmedAt = null
    zone.leaderConfirmedBy = null
    pushConclusion(zone, '已作废', `回路 ${zone.circuit} 由${previous}变为${next}，原放行结论作废`, '系统重算')
    const after = summarizeZone(zone)
    pushConclusion(zone, after.status, after.basis, '系统重算')
    addAudit(zone.id, '回路状态变化', operator, `回路 ${zone.circuit} ${previous}→${next}，分区放行作废并重算为「${after.status}」(V${zone.releaseVersion})`)
    return { ok: true, message: `回路已切换为${next}，分区结论重算为「${after.status}」` }
  }

  function completeZoneRetest(zoneId: string, operator: string) {
    const zone = findZone(zoneId)
    if (!zone) return { ok: false, message: '分区不存在' }
    if (zone.circuitStatus !== '接通') return { ok: false, message: '回路未接通，不能组织分区复测' }
    const summary = summarizeZone(zone)
    if (summary.openDefects.length) return { ok: false, message: `分区仍有 ${summary.openDefects.length} 台设备未闭环，不能复测` }
    if (zone.retestPassedAt) return { ok: false, message: '分区复测已完成，无需重复操作' }
    zone.retestPassedAt = new Date().toISOString()
    zone.retestBy = operator
    const after = summarizeZone(zone)
    pushConclusion(zone, after.status, after.basis, '系统重算')
    addAudit(zone.id, '分区复测通过', operator, `${zone.name} 复测通过，结论重算为「${after.status}」`)
    return { ok: true, message: '分区复测已通过，待值班长确认' }
  }

  function confirmZoneRelease(zoneId: string, operator: string) {
    const zone = findZone(zoneId)
    if (!zone) return { ok: false, message: '分区不存在' }
    if (!zone.retestPassedAt) return { ok: false, message: '分区复测未完成，值班长不能确认' }
    const summary = summarizeZone(zone)
    if (zone.circuitStatus !== '接通' || summary.openDefects.length) return { ok: false, message: '分区条件已变化，需重新组织复测' }
    if (zone.leaderConfirmedAt) return { ok: false, message: '值班长已确认，无需重复操作' }
    zone.leaderConfirmedAt = new Date().toISOString()
    zone.leaderConfirmedBy = operator
    const after = summarizeZone(zone)
    pushConclusion(zone, after.status, after.basis, '系统重算')
    addAudit(zone.id, '值班长确认放行', operator, `${zone.name} 复测与确认齐全，分区恢复开放`)
    return { ok: true, message: '值班长已确认，分区恢复开放' }
  }

  /** 旧数据缺分区号按设备关联回填，补不全的停在待核 */
  function runZoneBackfill(reason: string) {
    let assigned = 0
    let pending = 0
    for (const record of records.value) {
      if (record.zoneId || record.zonePending) continue
      const zone = zones.value.find((item) => item.deviceCodes.includes(record.deviceCode))
      if (zone) {
        record.zoneId = zone.id
        assigned += 1
        addAudit(record.id, '分区回填', '系统', `${reason}：按设备 ${record.deviceCode} 关联回填至「${zone.name}」`)
      } else {
        record.zonePending = true
        pending += 1
        addAudit(record.id, '分区待核', '系统', `${reason}：设备 ${record.deviceCode} 无分区映射，记录停在待核`)
      }
    }
    return { assigned, pending }
  }

  function assignRecordZone(recordId: string, zoneId: string, operator = '当前用户') {
    const record = records.value.find((item) => item.id === recordId)
    const zone = findZone(zoneId)
    if (!record || !zone) return
    record.zoneId = zone.id
    record.zonePending = false
    if (!zone.deviceCodes.includes(record.deviceCode)) zone.deviceCodes.push(record.deviceCode)
    addAudit(recordId, '分区人工核定', operator, `记录核定至「${zone.name}」，设备 ${record.deviceCode} 纳入分区映射`)
  }

  /** 离线补录按批次入库：合并/建档、分区回填、结论冲突双版保留 */
  function importOfflineBatch(input: OfflineBatchInput, operator = '当前用户') {
    if (!input.id || !Array.isArray(input.entries) || !input.entries.length) {
      return { ok: false, message: '批次格式不正确：需要 id 和 entries 列表' }
    }
    if (batches.value.some((batch) => batch.id === input.id)) {
      return { ok: false, message: `批次 ${input.id} 已入库，不能重复导入` }
    }
    let merged = 0
    let created = 0
    let conflicts = 0
    const touched: InspectionRecord[] = []
    for (const entry of input.entries) {
      if (!entry.id || !entry.deviceCode) continue
      const { zoneConclusion, ...data } = entry
      const existing = records.value.find((item) => item.id === entry.id)
      if (existing) {
        Object.assign(existing, data, { version: existing.version + 1, updatedAt: new Date().toISOString() })
        merged += 1
        touched.push(existing)
        addAudit(existing.id, '离线补录合并', operator, `批次 ${input.id} 合并为版本 V${existing.version}`)
      } else {
        const now = new Date().toISOString()
        const record: InspectionRecord = {
          deviceName: entry.deviceCode,
          area: '待核区',
          shift: '离线补录',
          inspector: operator,
          inspectedAt: now,
          status: '待检验',
          risk: '中',
          stopped: false,
          assignedTo: '待分配',
          dueDate: '2026-10-10',
          items: [],
          evidenceCount: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          ...data,
          id: entry.id,
          deviceCode: entry.deviceCode
        }
        records.value.unshift(record)
        created += 1
        touched.push(record)
        addAudit(record.id, '离线补录建档', operator, `批次 ${input.id} 新建记录`)
      }
    }
    const backfill = runZoneBackfill(`批次 ${input.id} 补录`)
    for (const record of touched) {
      if (['需整改', '整改中', '停用'].includes(record.status) || record.stopped) {
        invalidateZoneForRecord(record, `批次 ${input.id} 补录`)
      }
    }
    for (const entry of input.entries) {
      if (!entry.zoneConclusion) continue
      const record = records.value.find((item) => item.id === entry.id)
      const zone = record?.zoneId ? findZone(record.zoneId) : undefined
      if (!zone) continue
      const current = summarizeZone(zone)
      if (current.status !== entry.zoneConclusion) {
        conflicts += 1
        pushConclusion(zone, entry.zoneConclusion, `离线补录结论与现行「${current.status}」冲突，双版保留`, '离线补录', input.id, true)
        addAudit(zone.id, '分区结论冲突', operator, `批次 ${input.id} 补录结论「${entry.zoneConclusion}」与现行「${current.status}」冲突，两版均已保留`)
      }
    }
    const batch: OfflineBatch = {
      id: input.id,
      source: input.source || '离线终端',
      importedAt: new Date().toISOString(),
      total: input.entries.length,
      merged,
      created,
      backfilled: backfill.assigned,
      pending: backfill.pending,
      conflicts
    }
    batches.value.unshift(batch)
    addAudit(batch.id, '离线批次入库', operator, `${batch.source}：合并 ${merged}、新建 ${created}、回填 ${backfill.assigned}、待核 ${backfill.pending}、结论冲突 ${conflicts}（双版保留）`)
    return { ok: true, message: `批次 ${batch.id} 已入库：合并 ${merged}、新建 ${created}、冲突 ${conflicts}`, batch }
  }

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft)
    records.value.unshift(record)
    addAudit(record.id, '创建检验记录', draft.inspector, '新建设备班次检验任务')
    runZoneBackfill('新建检验任务')
    return record
  }

  function updateRecord(id: string, patch: Partial<InspectionRecord>, action = '保存检验记录') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (patch.stopped === false && record.stopped) {
      const summary = record.zoneId ? getZoneSummary(record.zoneId) : undefined
      if (!summary?.released) {
        return { ok: false, message: `分区未放行（${summary ? summary.basis : '记录分区待核'}），单台设备不能先行开放` }
      }
    }
    Object.assign(record, patch, { version: record.version + 1, updatedAt: new Date().toISOString() })
    addAudit(id, action, '当前用户', `记录更新至版本 V${record.version}`)
    if (patch.stopped === true) invalidateZoneForRecord(record, `设备 ${record.deviceCode} 停用隔离`)
    if (patch.items?.some((item) => item.result === '异常')) invalidateZoneForRecord(record, `设备 ${record.deviceCode} 检出异常项`)
    return { ok: true, message: `已保存，记录版本 V${record.version}` }
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
    if (next === '停用') record.stopped = true
    record.version += 1
    record.updatedAt = new Date().toISOString()
    addAudit(id, `状态流转：${next}`, '当前用户', detail)
    if (['需整改', '整改中', '停用'].includes(next)) {
      invalidateZoneForRecord(record, `任务 ${id} 流转至${next}`)
    }
    return { ok: true, message: `已流转至${next}` }
  }

  function addAudit(recordId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({
      id: `${recordId}-${Date.now()}-${auditSeq++}`,
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
    batches.value = []
    runZoneBackfill('演示数据重置')
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      records: records.value,
      audit: audit.value,
      zones: zones.value,
      batches: batches.value
    }))
  }

  watch([records, audit, zones, batches], persist, { deep: true })

  // 旧数据初始化：缺分区号按设备关联回填，补不全的停在待核
  runZoneBackfill('旧数据初始化')
  persist()

  return {
    records, audit, zones, batches, keyword, status, area, liveMessage,
    filtered, stats, pendingRecords, zoneSummaries,
    getZoneSummary, deviceRelease,
    setCircuitStatus, completeZoneRetest, confirmZoneRelease,
    runZoneBackfill, assignRecordZone, importOfflineBatch,
    addRecord, updateRecord, transition, resetDemo,
    sampleBatch: sampleOfflineBatch
  }
})
