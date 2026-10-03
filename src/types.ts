export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'

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
  items: InspectionItem[]
  evidenceCount: number
  version: number
  createdAt: string
  updatedAt: string
  /** 所属急停联锁分区；旧数据缺失时按设备关联回填 */
  zoneId?: string
  /** 设备无分区映射、无法回填时置为 true，记录停在待核 */
  zonePending?: boolean
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

/** 共用急停联锁回路状态 */
export type CircuitStatus = '接通' | '断开' | '检修中'

/** 分区放行现行结论（由回路、缺陷、复测、值班长确认实时重算） */
export type ZoneReleaseStatus = '已放行' | '待值班长确认' | '待分区复测' | '缺陷未闭环' | '回路中断'

/** 结论历史版本允许的状态，含被作废的旧结论 */
export type ZoneConclusionStatus = ZoneReleaseStatus | '已作废'

export interface ZoneConclusion {
  id: string
  zoneId: string
  version: number
  status: ZoneConclusionStatus
  basis: string
  source: '系统重算' | '离线补录'
  batchId?: string
  /** 与现行结论冲突的补录版本，双版保留 */
  conflict: boolean
  createdAt: string
}

export interface InterlockZone {
  id: string
  name: string
  /** 共用急停联锁回路编号 */
  circuit: string
  circuitStatus: CircuitStatus
  deviceCodes: string[]
  retestPassedAt: string | null
  retestBy: string | null
  leaderConfirmedAt: string | null
  leaderConfirmedBy: string | null
  releaseVersion: number
  conclusions: ZoneConclusion[]
}

/** 分区放行结论汇总，总览 / 看板 / 审计共用同一条结果 */
export interface ZoneSummary {
  zone: InterlockZone
  members: InspectionRecord[]
  openDefects: InspectionRecord[]
  status: ZoneReleaseStatus
  basis: string
  released: boolean
}

/** 单台设备的放行判定：任务闭环不等于开放，须分区结论放行 */
export interface DeviceRelease {
  released: boolean
  label: string
  reason: string
}

export interface OfflineBatchEntry extends Partial<InspectionRecord> {
  id: string
  deviceCode: string
  /** 离线端断言的分区结论，与现行结论冲突时双版保留 */
  zoneConclusion?: ZoneReleaseStatus
}

export interface OfflineBatchInput {
  id: string
  source: string
  entries: OfflineBatchEntry[]
}

export interface OfflineBatch {
  id: string
  source: string
  importedAt: string
  total: number
  merged: number
  created: number
  backfilled: number
  pending: number
  conflicts: number
}
