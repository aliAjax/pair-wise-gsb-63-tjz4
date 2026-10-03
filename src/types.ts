export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'
export type CircuitState = '接通' | '断开检修'
export type ZoneReleaseStatus = '已放行' | '待复测' | '待值班长确认' | '已作废'
export type BackfillStatus = '已回填' | '待核'
export type BatchEntryResult = '已入库' | '冲突双版保留' | '待核'

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  limit: string
  note: string
}

export interface InspectionRecord {
  id: string
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionStatus
  risk: RiskLevel
  stopped: boolean
  assignedTo: string
  dueDate: string
  zoneId: string | null
  backfillStatus?: BackfillStatus
  items: InspectionItem[]
  evidenceCount: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface InterlockZone {
  id: string
  name: string
  deviceCodes: string[]
  circuitState: CircuitState
  circuitUpdatedAt: string
}

export interface ZoneRelease {
  id: string
  zoneId: string
  status: ZoneReleaseStatus
  retestDone: boolean
  leaderConfirmed: boolean
  leader: string
  basis: string
  invalidatedBy: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ZoneConclusionConflict {
  id: string
  zoneId: string
  recordId: string
  localConclusion: ZoneReleaseStatus
  incomingConclusion: ZoneReleaseStatus
  resolution: '双版保留'
  createdAt: string
}

export interface OfflineBatchEntry {
  recordId: string
  zoneId: string | null
  conclusion: Exclude<ZoneReleaseStatus, '已作废'>
  retestDone: boolean
  leaderConfirmed: boolean
  operator: string
  recordedAt: string
}

export interface OfflineBatchResult {
  entry: OfflineBatchEntry
  result: BatchEntryResult
  note: string
}

export interface OfflineBatch {
  id: string
  source: string
  importedAt: string
  results: OfflineBatchResult[]
  conflicts: ZoneConclusionConflict[]
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface InspectionDraft {
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  risk: RiskLevel
  assignedTo: string
  dueDate: string
}
