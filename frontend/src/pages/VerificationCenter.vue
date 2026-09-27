<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePlaceStore } from '../stores/placeStore'
import { useVerificationStore } from '../stores/verificationStore'
import { useSheetStore } from '../stores/sheetStore'
import type { Certainty } from '../types/placePair'
import { CERTAINTIES } from '../types/placePair'
import {
  classifyCertaintyMove,
  describeCertaintyMove,
  validateVerification,
} from '../types/verification'
import { formatDateTime } from '../utils/format'
import PairRow from '../components/common/PairRow.vue'
import VacantHint from '../components/common/VacantHint.vue'

const route = useRoute()
const placeStore = usePlaceStore()
const verificationStore = useVerificationStore()
const sheetStore = useSheetStore()
const formErrors = ref<string[]>([])

const placePairId = computed(() => String(route.params.id ?? ''))
const pair = computed(() => {
  const current = placeStore.currentPair
  return current?.id === placePairId.value ? current : undefined
})
const sheet = computed(() => (pair.value ? sheetStore.getSheetById(pair.value.sheetId) : undefined))

const records = computed(() => verificationStore.currentVerifications)
const isLegacy = computed(() => records.value.length === 0)
/** 下一条留痕的原档位：有记录取最近一条的结果，旧对照无记录时取其原有档位。 */
const fromCertainty = computed<Certainty | null>(
  () => records.value[records.value.length - 1]?.toCertainty ?? pair.value?.certainty ?? null,
)

interface VerificationForm {
  toCertainty: Certainty
  sourceRef: string
  reason: string
  verifier: string
  note: string
}

function createEmptyForm(): VerificationForm {
  const latest = records.value[records.value.length - 1]
  return {
    toCertainty: fromCertainty.value ?? '待考',
    sourceRef: '',
    reason: '',
    verifier: latest?.verifier ?? '',
    note: '',
  }
}

const form = reactive<VerificationForm>({
  toCertainty: '待考',
  sourceRef: '',
  reason: '',
  verifier: '',
  note: '',
})

const moveKind = computed(() =>
  fromCertainty.value === null ? '首录' : classifyCertaintyMove(fromCertainty.value, form.toCertainty),
)

/** 依据所选变动方向，给出需要填写什么的前置提示。 */
const moveGuidance = computed<string[]>(() => {
  const tips: string[] = []
  if (form.toCertainty === '确定') {
    tips.push('标为「确定」必须填写所据书目、卷页或档案号。')
  }
  if (moveKind.value === '升级') {
    tips.push('档位前推一级（待考→存疑、存疑→确定）须写明出处。')
  }
  if (moveKind.value === '跳级') {
    tips.push('跨档调整属跳级，须写明理由；向前跳级仍须提供出处。')
  }
  if (moveKind.value === '降级') {
    tips.push('档位回调须写明回调原因。')
  }
  if (moveKind.value === '同级') {
    tips.push('档位不变时，请补录依据书目或核证说明。')
  }
  return tips
})

const moveTagType: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  升级: 'success',
  降级: 'warning',
  跳级: 'danger',
  同级: 'info',
  首录: 'info',
}

async function submitVerification(): Promise<void> {
  if (!pair.value || fromCertainty.value === null) {
    return
  }
  const errors = validateVerification({
    from: fromCertainty.value,
    to: form.toCertainty,
    sourceRef: form.sourceRef,
    reason: form.reason,
    verifier: form.verifier,
  })
  if (errors.length) {
    formErrors.value = errors
    return
  }
  await verificationStore.addVerification({
    placePairId: placePairId.value,
    fromCertainty: fromCertainty.value,
    toCertainty: form.toCertainty,
    sourceRef: form.sourceRef.trim(),
    reason: form.reason.trim(),
    verifier: form.verifier.trim(),
    verifiedAt: new Date().toISOString(),
    note: form.note.trim(),
  })
  placeStore.updateCertainty(placePairId.value, form.toCertainty)
  Object.assign(form, createEmptyForm())
  formErrors.value = []
}

async function initialize(): Promise<void> {
  await Promise.all([sheetStore.init(), placeStore.init(), verificationStore.init()])
  await placeStore.loadPair(placePairId.value)
  await verificationStore.loadFor(placePairId.value)
  Object.assign(form, createEmptyForm())
}

onMounted(() => {
  void initialize()
})

watch(placePairId, () => {
  void initialize()
})
</script>

<template>
  <section v-if="pair" class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">VERIFICATION TRAIL</span>
        <h1>{{ pair.oldName }} 核证留痕</h1>
        <p>确定度的每次调整都登记核证人、依据书目与时间；逐级前推须列出处，跳级或回调须写明理由。</p>
      </div>
      <router-link to="/places"><el-button>返回地名对照台</el-button></router-link>
    </div>

    <div class="detail-layout">
      <div>
        <PairRow
          :pair="pair"
          :sheet-code="sheet?.code ?? '图幅待补'"
          :basis="verificationStore.getLatestBasis(pair.id)"
        />

        <div class="section-title">
          <h2>核证经过</h2>
          <span class="muted">共 {{ records.length }} 条</span>
        </div>

        <el-alert
          v-if="isLegacy"
          type="info"
          :closable="false"
          show-icon
          class="legacy-alert"
          title="该对照为早先录入，尚无核证记录"
          description="当前确定度档位照旧保留；补充核证时会从现有档位起算变动，并在此留下第一条经过。"
        />

        <div v-if="records.length" class="timeline-wrap">
          <el-timeline>
            <el-timeline-item
              v-for="record in records"
              :key="record.id"
              :timestamp="formatDateTime(record.verifiedAt)"
              placement="top"
              color="#8b3f2f"
            >
              <div class="timeline-item__head">
                <span class="timeline-item__name">{{ describeCertaintyMove(record.fromCertainty, record.toCertainty) }}</span>
                <el-tag :type="moveTagType[classifyCertaintyMove(record.fromCertainty, record.toCertainty)]" effect="plain">
                  {{ classifyCertaintyMove(record.fromCertainty, record.toCertainty) }}
                </el-tag>
              </div>
              <p class="timeline-item__source">
                依据：{{ record.sourceRef || '未列出处' }}<span v-if="record.reason">；理由：{{ record.reason }}</span>
              </p>
              <p class="timeline-item__note">{{ record.note || '暂无补注。' }}</p>
              <p class="timeline-item__verifier">核证人：{{ record.verifier }}</p>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>

      <aside>
        <form class="inline-form" data-testid="form-verification" @submit.prevent="submitVerification">
          <h2>登记核证变动</h2>

          <el-form-item label="当前档位">
            <div class="current-certainty">
              <el-tag>{{ fromCertainty ?? '—' }}</el-tag>
              <span class="current-certainty__arrow" aria-hidden="true">→</span>
              <el-tag type="warning">{{ form.toCertainty }}</el-tag>
              <el-tag size="small" :type="moveTagType[moveKind]" effect="plain">{{ moveKind }}</el-tag>
            </div>
          </el-form-item>

          <el-form-item label="调整后档位" required>
            <select v-model="form.toCertainty" class="native-field" data-testid="field-toCertainty">
              <option v-for="certainty in CERTAINTIES" :key="certainty" :value="certainty">{{ certainty }}</option>
            </select>
          </el-form-item>

          <ul v-if="moveGuidance.length" class="move-guidance">
            <li v-for="tip in moveGuidance" :key="tip">{{ tip }}</li>
          </ul>

          <el-form-item label="依据书目 / 卷页" :required="form.toCertainty === '确定' || moveKind === '升级'">
            <input
              v-model="form.sourceRef"
              class="native-field"
              data-testid="field-sourceRef"
              placeholder="例如：《日下旧闻考》卷九十五"
            />
          </el-form-item>
          <el-form-item
            label="变动理由"
            :required="moveKind === '跳级' || moveKind === '降级'"
          >
            <textarea
              v-model="form.reason"
              class="native-field"
              data-testid="field-reason"
              rows="3"
              placeholder="跳级或回调时必须写明理由"
            ></textarea>
          </el-form-item>
          <el-form-item label="核证人" required>
            <input v-model="form.verifier" class="native-field" data-testid="field-verifier" placeholder="本次由谁核证" />
          </el-form-item>
          <el-form-item label="核证补注">
            <textarea v-model="form.note" class="native-field" data-testid="field-note" rows="3"></textarea>
          </el-form-item>

          <ul v-if="formErrors.length" class="form-errors" data-testid="verification-errors">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <el-button type="primary" native-type="submit" style="width: 100%" data-testid="submit-verification">
            保存核证
          </el-button>
        </form>
      </aside>
    </div>
  </section>

  <section v-else class="page">
    <h1>核证留痕</h1>
    <VacantHint title="未找到地名对照" description="请返回地名对照台选择有效记录。" />
  </section>
</template>

<style scoped>
.legacy-alert {
  margin-bottom: 18px;
}

.current-certainty {
  display: flex;
  align-items: center;
  gap: 8px;
}

.current-certainty__arrow {
  color: #aa8c72;
  font-family: Georgia, serif;
  font-size: 18px;
}

.move-guidance {
  margin: -4px 0 14px;
  padding: 10px 12px 10px 28px;
  color: #7a5a48;
  background: #f0e6d6;
  border-left: 3px solid #a65d48;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.7;
}

.form-errors {
  margin: 0 0 12px;
  padding: 10px 12px 10px 28px;
  color: #a33f32;
  background: #f6e7e3;
  border: 1px solid #d9aaa2;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.7;
}

.timeline-item__verifier {
  margin: 6px 0 0;
  color: #8d7965;
  font-size: 12px;
}
</style>
