import type { AuditEntry, InspectionItem, InspectionRecord, InterlockZone, ZoneRelease } from '../types'

const standardItems = (abnormal = false): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: abnormal ? '异常' : '正常', reading: abnormal ? '6.8 mm' : '2.1 mm', limit: '≤ 5.0 mm', note: abnormal ? '主支撑连接处磨损超限' : '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '≤ 3.0 m', note: '' },
  { id: 'lock', name: '锁止机构', result: abnormal ? '异常' : '正常', reading: abnormal ? '存在间隙' : '闭合可靠', limit: '无可见间隙', note: abnormal ? '安全压杠锁止存在回弹' : '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '动作可靠', note: '' }
]

export const seedZones: InterlockZone[] = [
  {
    id: 'LOOP-01', name: '北园急停联锁回路', deviceCodes: ['AM-014', 'RC-007'],
    circuitState: '断开检修', circuitUpdatedAt: '2026-09-28T09:10:00'
  },
  {
    id: 'LOOP-02', name: '湖区急停联锁回路', deviceCodes: ['CR-021', 'WF-003'],
    circuitState: '接通', circuitUpdatedAt: '2026-09-27T18:00:00'
  }
]

export const seedReleases: ZoneRelease[] = [
  {
    id: 'REL-LOOP-01-V2', zoneId: 'LOOP-01', status: '待复测',
    retestDone: false, leaderConfirmed: false, leader: '',
    basis: '回路状态变更：接通→断开检修，原放行作废，待重新复测', invalidatedBy: '',
    version: 2, createdAt: '2026-09-28T09:10:00', updatedAt: '2026-09-28T09:10:00'
  },
  {
    id: 'REL-LOOP-01-V1', zoneId: 'LOOP-01', status: '已作废',
    retestDone: true, leaderConfirmed: true, leader: '高岩',
    basis: '早班分区复测通过，值班长确认放行', invalidatedBy: '回路状态变更：接通→断开检修',
    version: 1, createdAt: '2026-09-27T18:05:00', updatedAt: '2026-09-28T09:10:00'
  },
  {
    id: 'REL-LOOP-02-V3', zoneId: 'LOOP-02', status: '已放行',
    retestDone: true, leaderConfirmed: true, leader: '高岩',
    basis: '分区复测与值班长确认齐全，分区恢复开放', invalidatedBy: '',
    version: 3, createdAt: '2026-09-27T18:10:00', updatedAt: '2026-09-27T18:10:00'
  }
]

export const seedRecords: InspectionRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修一组', dueDate: '2026-09-29',
    zoneId: 'LOOP-01', items: standardItems(true), evidenceCount: 4, version: 3, createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T09:35:00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: true, assignedTo: '电气班组', dueDate: '2026-09-30',
    zoneId: 'LOOP-01', items: standardItems(true), evidenceCount: 2, version: 2, createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false, assignedTo: '检验二组', dueDate: '2026-09-29',
    zoneId: 'LOOP-02', items: standardItems(), evidenceCount: 3, version: 4, createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-28',
    zoneId: 'LOOP-02', items: standardItems(), evidenceCount: 5, version: 5, createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00'
  },
  {
    id: 'INS-240821-05', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '晚班', inspector: '李琪',
    inspectedAt: '2026-09-26T20:10:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '电气班组', dueDate: '2026-09-27',
    zoneId: null, items: standardItems(), evidenceCount: 1, version: 2, createdAt: '2026-09-26T20:10:00', updatedAt: '2026-09-27T09:00:00'
  },
  {
    id: 'INS-240821-06', deviceCode: 'BG-002', deviceName: '碰碰车', area: 'C区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-26T14:30:00', status: '待检验', risk: '中', stopped: false, assignedTo: '维修二组', dueDate: '2026-10-02',
    zoneId: null, items: standardItems(), evidenceCount: 0, version: 1, createdAt: '2026-09-26T14:30:00', updatedAt: '2026-09-26T14:30:00'
  }
]

export const seedAudit: AuditEntry[] = [
  ...seedRecords.flatMap((record) => [
    { id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector, detail: `${record.deviceName}完成班前检验`, createdAt: record.createdAt },
    ...(record.version > 1 ? [{ id: `${record.id}-A${record.version}`, recordId: record.id, action: record.status, operator: '系统流转', detail: `记录更新至版本 V${record.version}`, createdAt: record.updatedAt }] : [])
  ]),
  { id: 'LOOP-01-A1', recordId: 'LOOP-01', action: '回路状态变更：断开检修', operator: '检修调度', detail: '北园急停联锁回路断开检修，分区放行立即作废重算', createdAt: '2026-09-28T09:10:00' },
  { id: 'LOOP-01-A2', recordId: 'LOOP-01', action: '分区放行作废重算', operator: '系统联锁', detail: 'REL-LOOP-01-V1 作废，生成 REL-LOOP-01-V2（待复测）', createdAt: '2026-09-28T09:10:01' },
  { id: 'LOOP-02-A1', recordId: 'LOOP-02', action: '值班长确认放行', operator: '高岩', detail: '湖区回路分区复测与确认齐全，分区恢复开放', createdAt: '2026-09-27T18:10:00' }
]
