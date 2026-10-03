import type { AuditEntry, InspectionItem, InspectionRecord, InterlockZone, OfflineBatchInput } from '../types'

export const standardItems = (abnormal = false): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: abnormal ? '异常' : '正常', reading: abnormal ? '6.8 mm' : '2.1 mm', limit: '≤ 5.0 mm', note: abnormal ? '主支撑连接处磨损超限' : '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '≤ 3.0 m', note: '' },
  { id: 'lock', name: '锁止机构', result: abnormal ? '异常' : '正常', reading: abnormal ? '存在间隙' : '闭合可靠', limit: '无可见间隙', note: abnormal ? '安全压杠锁止存在回弹' : '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '动作可靠', note: '' }
]

export const seedRecords: InspectionRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修一组', dueDate: '2026-09-29',
    items: standardItems(true), evidenceCount: 4, version: 3, createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T09:35:00',
    zoneId: 'ZONE-NORTH'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: false, assignedTo: '电气班组', dueDate: '2026-09-30',
    items: standardItems(true), evidenceCount: 2, version: 2, createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00',
    zoneId: 'ZONE-NORTH'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false, assignedTo: '检验二组', dueDate: '2026-09-29',
    items: standardItems(), evidenceCount: 3, version: 4, createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00',
    zoneId: 'ZONE-LAKE'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-28',
    items: standardItems(), evidenceCount: 5, version: 5, createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00',
    zoneId: 'ZONE-LAKE'
  },
  {
    // 旧数据：缺分区号，初始化时按设备 WF-003 关联回填至湖滨分区
    id: 'INS-240815-01', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '晚班', inspector: '赵帆',
    inspectedAt: '2026-09-15T19:20:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-16',
    items: standardItems(), evidenceCount: 2, version: 2, createdAt: '2026-09-15T19:20:00', updatedAt: '2026-09-16T09:10:00'
  },
  {
    // 旧数据：设备无分区映射，回填补不全，停在待核
    id: 'INS-240815-02', deviceCode: 'XX-909', deviceName: '退役滑行龙', area: '仓储区', shift: '中班', inspector: '周宁',
    inspectedAt: '2026-09-14T14:00:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修一组', dueDate: '2026-09-15',
    items: standardItems(), evidenceCount: 1, version: 1, createdAt: '2026-09-14T14:00:00', updatedAt: '2026-09-14T14:00:00'
  }
]

export const seedZones: InterlockZone[] = [
  {
    id: 'ZONE-NORTH', name: '北园急停联锁分区', circuit: 'EST-N1', circuitStatus: '检修中',
    deviceCodes: ['AM-014', 'RC-007'],
    retestPassedAt: null, retestBy: null, leaderConfirmedAt: null, leaderConfirmedBy: null,
    releaseVersion: 2,
    conclusions: [
      { id: 'ZONE-NORTH-C2', zoneId: 'ZONE-NORTH', version: 2, status: '回路中断', basis: '检修断开回路 EST-N1，分区放行作废', source: '系统重算', conflict: false, createdAt: '2026-09-28T07:10:00' },
      { id: 'ZONE-NORTH-C1', zoneId: 'ZONE-NORTH', version: 1, status: '已作废', basis: '开园前放行结论因检修断开回路作废', source: '系统重算', conflict: false, createdAt: '2026-09-28T07:10:00' }
    ]
  },
  {
    id: 'ZONE-LAKE', name: '湖滨急停联锁分区', circuit: 'EST-L2', circuitStatus: '接通',
    deviceCodes: ['CR-021', 'WF-003'],
    retestPassedAt: null, retestBy: null, leaderConfirmedAt: null, leaderConfirmedBy: null,
    releaseVersion: 1,
    conclusions: [
      { id: 'ZONE-LAKE-C1', zoneId: 'ZONE-LAKE', version: 1, status: '缺陷未闭环', basis: '旋转木马复测未完成，分区暂缓放行', source: '系统重算', conflict: false, createdAt: '2026-09-28T10:30:00' }
    ]
  }
]

export const sampleOfflineBatch: OfflineBatchInput = {
  id: 'BATCH-20261003-01',
  source: '北园移动检验终端（离线）',
  entries: [
    {
      id: 'INS-240821-02', deviceCode: 'RC-007', status: '已关闭', stopped: false,
      items: standardItems(),
      zoneConclusion: '已放行'
    },
    {
      id: 'INS-240903-07', deviceCode: 'HH-002', deviceName: '欢乐海盗船', area: 'B区',
      shift: '晚班', inspector: '离线终端', status: '需整改', risk: '高', stopped: true,
      assignedTo: '维修二组', dueDate: '2026-10-05',
      items: standardItems(true), evidenceCount: 2
    }
  ]
}

export const seedAudit: AuditEntry[] = seedRecords.flatMap((record) => [
  { id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector, detail: `${record.deviceName}完成班前检验`, createdAt: record.createdAt },
  ...(record.version > 1 ? [{ id: `${record.id}-A${record.version}`, recordId: record.id, action: record.status, operator: '系统流转', detail: `记录更新至版本 V${record.version}`, createdAt: record.updatedAt }] : [])
])
