<script setup lang="ts">
import { h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { CircuitStatus, OfflineBatchInput, ZoneReleaseStatus } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const circuitOptions = ['接通', '断开', '检修中'].map((value) => ({ label: value, value }))
const batchText = ref('')
const batchError = ref('')

const releaseTagType = (status: ZoneReleaseStatus | string) =>
  status === '已放行' ? 'success' : status === '回路中断' ? 'error' : status === '缺陷未闭环' ? 'warning' : 'info'

const deviceTagType = (recordId: string) => {
  const record = store.records.find((item) => item.id === recordId)
  if (!record) return 'default'
  const release = store.deviceRelease(record)
  return release.released ? 'success' : release.label === '分区待核' ? 'warning' : release.label === '分区未放行' ? 'error' : 'default'
}

function onCircuitChange(zoneId: string, zoneName: string, next: CircuitStatus) {
  dialog.warning({
    title: `确认切换回路状态为${next}`,
    content: `回路状态一变化，${zoneName}现行放行结论立即作废重算，需重新完成分区复测和值班长确认。`,
    positiveText: '确认切换',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.setCircuitStatus(zoneId, next, '周宁')
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

function retest(zoneId: string) {
  const result = store.completeZoneRetest(zoneId, '周宁')
  result.ok ? message.success(result.message) : message.error(result.message)
}

function confirm(zoneId: string) {
  const result = store.confirmZoneRelease(zoneId, '值班长 陈立')
  result.ok ? message.success(result.message) : message.error(result.message)
}

function loadSample() {
  batchText.value = JSON.stringify(store.sampleBatch, null, 2)
  batchError.value = ''
}

function importBatch() {
  batchError.value = ''
  let parsed: OfflineBatchInput
  try {
    parsed = JSON.parse(batchText.value)
  } catch {
    batchError.value = 'JSON 解析失败，请检查批次内容'
    return
  }
  const result = store.importOfflineBatch(parsed, '周宁')
  result.ok ? message.success(result.message) : (batchError.value = result.message)
}

const batchColumns = [
  { title: '批次号', key: 'id', width: 170 },
  { title: '来源', key: 'source', width: 180 },
  { title: '入库时间', key: 'importedAt', width: 130, render: (row: any) => row.importedAt.replace('T', ' ').slice(5, 16) },
  { title: '条目', key: 'total', width: 60 },
  { title: '合并', key: 'merged', width: 60 },
  { title: '新建', key: 'created', width: 60 },
  { title: '回填', key: 'backfilled', width: 60 },
  { title: '待核', key: 'pending', width: 60 },
  { title: '冲突', key: 'conflicts', width: 70, render: (row: any) => h(NTag, { size: 'small', type: row.conflicts ? 'error' : 'default', bordered: false }, { default: () => row.conflicts }) }
]
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div>
        <h2>联锁分区放行</h2>
        <p>共用急停联锁回路按分区出结论：回路状态一变化放行立即作废重算；单台通过不能先开放，分区复测与值班长确认齐全才恢复。</p>
      </div>
    </div>

    <div class="zone-grid">
      <article v-for="summary in store.zoneSummaries" :key="summary.zone.id" class="zone-card">
        <header>
          <div>
            <h3>{{ summary.zone.name }}</h3>
            <p>回路 {{ summary.zone.circuit }} · 成员设备 {{ summary.zone.deviceCodes.join(' / ') }}</p>
          </div>
          <NTag :type="releaseTagType(summary.status)" :bordered="false">{{ summary.status }}</NTag>
        </header>

        <div class="circuit-band">
          <span>回路状态</span>
          <NSelect
            :value="summary.zone.circuitStatus"
            :options="circuitOptions"
            @update:value="(value: CircuitStatus) => onCircuitChange(summary.zone.id, summary.zone.name, value)"
          />
          <small>{{ summary.basis }}</small>
        </div>

        <ul class="zone-checklist">
          <li :class="{ done: summary.zone.circuitStatus === '接通' }">回路接通</li>
          <li :class="{ done: !summary.openDefects.length }">缺陷闭环（未闭环 {{ summary.openDefects.length }}）</li>
          <li :class="{ done: !!summary.zone.retestPassedAt }">分区复测{{ summary.zone.retestBy ? ` · ${summary.zone.retestBy}` : '' }}</li>
          <li :class="{ done: !!summary.zone.leaderConfirmedAt }">值班长确认{{ summary.zone.leaderConfirmedBy ? ` · ${summary.zone.leaderConfirmedBy}` : '' }}</li>
        </ul>

        <div class="zone-actions">
          <NButton
            size="small"
            :disabled="summary.zone.circuitStatus !== '接通' || summary.openDefects.length > 0 || !!summary.zone.retestPassedAt"
            @click="retest(summary.zone.id)"
          >完成分区复测</NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!summary.zone.retestPassedAt || !!summary.zone.leaderConfirmedAt"
            @click="confirm(summary.zone.id)"
          >值班长确认放行</NButton>
        </div>

        <div class="member-list">
          <div v-for="member in summary.members" :key="member.id" class="member-line" @click="router.push(`/records/${member.id}`)">
            <span>{{ member.deviceName }} <small>{{ member.deviceCode }} · {{ member.id }}</small></span>
            <span>{{ member.status }}</span>
            <NTag size="small" :type="deviceTagType(member.id)" :bordered="false">{{ store.deviceRelease(member).label }}</NTag>
          </div>
          <div v-if="!summary.members.length" class="kanban-empty">分区内暂无检验记录</div>
        </div>

        <div class="conclusion-history">
          <h4>结论版本（V{{ summary.zone.releaseVersion }} · 冲突双版保留）</h4>
          <p v-for="conclusion in summary.zone.conclusions" :key="conclusion.id" :class="{ conflict: conclusion.conflict }">
            <b>V{{ conclusion.version }}</b>
            <span>{{ conclusion.status }}</span>
            <span>{{ conclusion.basis }}</span>
            <NTag v-if="conclusion.conflict" size="tiny" type="error" :bordered="false">冲突保留 · {{ conclusion.batchId }}</NTag>
            <small>{{ conclusion.createdAt.replace('T', ' ').slice(5, 16) }}</small>
          </p>
        </div>
      </article>
    </div>

    <div v-if="store.pendingRecords.length" class="pending-panel">
      <h3>待核记录（{{ store.pendingRecords.length }}）</h3>
      <p class="panel-note">旧数据缺分区号且设备无映射，回填补不全，停在待核；人工核定后纳入分区结论。</p>
      <div v-for="record in store.pendingRecords" :key="record.id" class="pending-item">
        <span>{{ record.id }} · {{ record.deviceName }}（{{ record.deviceCode }}）· {{ record.status }}</span>
        <NSelect
          size="small"
          placeholder="核定分区"
          style="width: 200px"
          :options="store.zones.map((zone) => ({ label: zone.name, value: zone.id }))"
          @update:value="(value: string) => { store.assignRecordZone(record.id, value, '周宁'); message.success(`已核定至分区`) }"
        />
      </div>
    </div>

    <div class="batch-panel">
      <h3>离线补录批次入库</h3>
      <p class="panel-note">离线终端记录按批次入库：已有编号合并为新版本，新编号建档；缺分区号按设备关联回填；分区结论与现行冲突时两版均保留。</p>
      <NInput v-model:value="batchText" type="textarea" :rows="9" placeholder='粘贴批次 JSON，或点击"载入示例批次"' />
      <div class="batch-actions">
        <NButton @click="loadSample">载入示例批次</NButton>
        <NButton type="primary" :disabled="!batchText.trim()" @click="importBatch">批次入库</NButton>
        <span v-if="batchError" class="validation">{{ batchError }}</span>
      </div>
      <NDataTable :columns="batchColumns" :data="store.batches" :bordered="false" size="small" :row-key="(row: any) => row.id" />
    </div>
  </section>
</template>
