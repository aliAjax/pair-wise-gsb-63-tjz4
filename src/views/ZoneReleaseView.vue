<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { sampleOfflineBatch } from '../services/api'
import type { OfflineBatch, OfflineBatchEntry } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()

const leaderOptions = ['高岩', '林素'].map((value) => ({ label: `值班长 · ${value}`, value }))
const leaderPick = reactive<Record<string, string>>({})
const leaderOf = (zoneId: string) => leaderPick[zoneId] ?? '高岩'

const conclusionType = (conclusion: string) =>
  conclusion === '已放行' ? 'success' : conclusion === '待核' || conclusion.includes('断开') ? 'error' : 'warning'

function toggleCircuit(zoneId: string, current: string) {
  const next = current === '接通' ? '断开检修' : '接通'
  const result = store.setCircuitState(zoneId, next as '接通' | '断开检修')
  result.ok ? message.success(result.message) : message.warning(result.message)
}

function retest(zoneId: string) {
  const result = store.completeZoneRetest(zoneId)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function confirm(zoneId: string) {
  const result = store.confirmZoneLeader(zoneId, leaderOf(zoneId))
  result.ok ? message.success(result.message) : message.error(result.message)
}

function retryBackfill() {
  const { filled, pending } = store.backfillLegacyZones(true)
  message.info(`回填 ${filled} 条，仍待核 ${pending} 条`)
}

// —— 离线补录 ——
const showBatch = ref(false)
const batchText = ref('')
const lastBatch = ref<OfflineBatch | null>(null)

function loadSample() {
  batchText.value = JSON.stringify(sampleOfflineBatch(), null, 2)
}

function runImport() {
  try {
    const entries = JSON.parse(batchText.value) as OfflineBatchEntry[]
    if (!Array.isArray(entries) || !entries.length) throw new Error('empty')
    lastBatch.value = store.importOfflineBatch('值班室离线终端', entries)
    showBatch.value = false
    message.success(`批次 ${lastBatch.value.id} 已入库`)
  } catch {
    message.error('批次格式不正确，需为补录条目数组')
  }
}

const resultType = (result: string) => result === '已入库' ? 'success' : result === '待核' ? 'error' : 'warning'
const zoneDevices = computed(() => store.zones.map((zone) => ({
  zone,
  devices: store.records.filter((record) => record.zoneId === zone.id)
})))
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div>
        <h2>联锁分区放行中心</h2>
        <p>共用急停联锁回路的设备、检验任务、缺陷处置与放行记录汇成同一分区结论；回路状态一变化，分区放行立即作废重算。</p>
      </div>
      <div class="intro-actions">
        <NButton @click="retryBackfill">重试待核回填</NButton>
        <NButton type="primary" @click="showBatch = true; loadSample()">离线补录批次入库</NButton>
      </div>
    </div>

    <div class="zone-grid">
      <article v-for="{ zone, devices } in zoneDevices" :key="zone.id" class="zone-card">
        <header>
          <div>
            <strong>{{ zone.name }}</strong>
            <small>{{ zone.id }} · 联锁设备 {{ zone.deviceCodes.join(' / ') }}</small>
          </div>
          <NTag :type="zone.circuitState === '接通' ? 'success' : 'error'" :bordered="false">回路{{ zone.circuitState }}</NTag>
        </header>

        <div class="conclusion-line">
          <span>分区结论</span>
          <NTag :type="conclusionType(store.zoneConclusion(zone.id))" size="large" :bordered="false">{{ store.zoneConclusion(zone.id) }}</NTag>
        </div>

        <div class="circuit-band">
          <NButton v-if="zone.circuitState === '接通'" size="small" @click="toggleCircuit(zone.id, zone.circuitState)">断开检修</NButton>
          <NButton v-else size="small" type="primary" @click="toggleCircuit(zone.id, zone.circuitState)">恢复接通</NButton>
          <small>回路状态一变化，当前放行立即作废并重算</small>
        </div>

        <ul class="checklist">
          <li :class="{ done: store.activeRelease(zone.id)?.retestDone }">
            <span>分区复测</span>
            <NButton size="tiny" :disabled="store.activeRelease(zone.id)?.retestDone" @click="retest(zone.id)">
              {{ store.activeRelease(zone.id)?.retestDone ? '已完成' : '完成复测' }}
            </NButton>
          </li>
          <li :class="{ done: store.activeRelease(zone.id)?.leaderConfirmed }">
            <span>值班长确认</span>
            <div class="leader-row">
              <NSelect v-model:value="leaderPick[zone.id]" :options="leaderOptions" size="tiny" style="width: 132px" :disabled="!!store.activeRelease(zone.id)?.leaderConfirmed" />
              <NButton size="tiny" :disabled="!store.activeRelease(zone.id)?.retestDone || store.activeRelease(zone.id)?.leaderConfirmed" @click="confirm(zone.id)">
                {{ store.activeRelease(zone.id)?.leaderConfirmed ? `已确认 · ${store.activeRelease(zone.id)?.leader}` : '确认放行' }}
              </NButton>
            </div>
          </li>
        </ul>
        <p class="gate-note">单台设备检验通过不能先行开放，分区复测与值班长确认齐全后分区才恢复。</p>

        <div class="zone-devices">
          <div v-for="record in devices" :key="record.id" class="zone-device" @click="router.push(`/records/${record.id}`)">
            <span>{{ record.deviceName }}<small>{{ record.deviceCode }}</small></span>
            <NTag size="small" :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">
              {{ record.stopped ? '停用' : record.status }}
            </NTag>
          </div>
        </div>

        <details class="release-history">
          <summary>放行版本沿革（{{ store.releasesFor(zone.id).length }}）</summary>
          <p v-for="release in store.releasesFor(zone.id)" :key="release.id">
            <b>V{{ release.version }} · {{ release.status }}</b>
            <span>{{ release.invalidatedBy ? `作废原因：${release.invalidatedBy}` : release.basis }}</span>
          </p>
        </details>
      </article>
    </div>

    <div v-if="lastBatch" class="batch-result">
      <h3>最近入库批次 {{ lastBatch.id }}<small>来源 {{ lastBatch.source }} · {{ lastBatch.importedAt.replace('T', ' ').slice(0, 19) }}</small></h3>
      <table>
        <thead><tr><th>检验编号</th><th>补录结论</th><th>入库结果</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="item in lastBatch.results" :key="item.entry.recordId">
            <td>{{ item.entry.recordId }}</td>
            <td>{{ item.entry.conclusion }}</td>
            <td><NTag size="small" :type="resultType(item.result)" :bordered="false">{{ item.result }}</NTag></td>
            <td>{{ item.note }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="lastBatch.conflicts.length" class="conflict-list">
        <strong>结论冲突 · 双版保留</strong>
        <p v-for="conflict in lastBatch.conflicts" :key="conflict.id">
          {{ conflict.zoneId }} / {{ conflict.recordId }}：本地版「{{ conflict.localConclusion }}」与补录版「{{ conflict.incomingConclusion }}」均已保留，待值班长裁决。
        </p>
      </div>
    </div>

    <div v-if="store.pendingRecords.length" class="pending-zone">
      <h3>待核记录<small>旧数据缺分区号且设备未登记联锁分区，补不全的停在待核</small></h3>
      <div v-for="record in store.pendingRecords" :key="record.id" class="pending-row">
        <span>{{ record.id }} · {{ record.deviceName }}（{{ record.deviceCode }}）</span>
        <NTag size="small" type="error" :bordered="false">待核</NTag>
      </div>
    </div>

    <NModal v-model:show="showBatch" preset="card" title="离线补录批次入库" style="width: 640px">
      <p class="batch-tip">离线终端补录按批次入库；与本地分区结论冲突时两版均保留，缺分区号的条目按设备关联回填，补不全停在待核。</p>
      <textarea v-model="batchText" class="batch-input" rows="12" spellcheck="false" />
      <template #footer>
        <div class="modal-actions">
          <NButton @click="loadSample">载入模拟批次</NButton>
          <NButton @click="showBatch = false">取消</NButton>
          <NButton type="primary" :disabled="!batchText.trim()" @click="runImport">批次入库</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
