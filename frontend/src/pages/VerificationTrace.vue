<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePlaceStore } from '../stores/placeStore'
import { useSheetStore } from '../stores/sheetStore'
import { useVerificationStore, VerificationRejectedError } from '../stores/verificationStore'
import { CERTAINTIES } from '../types/placePair'
import type { VerificationIssue, VerificationKind } from '../types/verification'
import { classifyVerification, nextCertainty, validateVerification } from '../types/verification'
import { formatDateTime } from '../utils/export'
import PairRow from '../components/common/PairRow.vue'
import VacantHint from '../components/common/VacantHint.vue'

const route = useRoute()
const placeStore = usePlaceStore()
const sheetStore = useSheetStore()
const verificationStore = useVerificationStore()

const placePairId = computed(() => String(route.params.id ?? ''))
const pair = computed(() => {
  const current = placeStore.currentPair
  return current?.id === placePairId.value ? current : placeStore.getPairById(placePairId.value)
})
const sheet = computed(() => (pair.value ? sheetStore.getSheetById(pair.value.sheetId) : undefined))
const records = computed(() =>
  pair.value ? [...verificationStore.getForPair(pair.value.id)].reverse() : [],
)

interface VerificationFormState {
  toCertainty: (typeof CERTAINTIES)[number]
  verifier: string
  sourceRef: string
  reason: string
}

function createEmptyForm(): VerificationFormState {
  return {
    toCertainty: pair.value ? nextCertainty(pair.value.certainty) : '存疑',
    verifier: '',
    sourceRef: '',
    reason: '',
  }
}

const form = reactive<VerificationFormState>(createEmptyForm())
const formError = ref('')
const fieldErrors = ref<VerificationIssue[]>([])
const savedFlash = ref(false)

const kind = computed<VerificationKind | null>(() =>
  pair.value ? classifyVerification(pair.value.certainty, form.toCertainty) : null,
)

const kindHint = computed(() => {
  if (!pair.value || !kind.value) {
    return ''
  }
  if (kind.value === '单级推进') {
    return `由「${pair.value.certainty}」往前推一级至「${form.toCertainty}」，须写出处。`
  }
  if (kind.value === '跳级提确') {
    return `由「${pair.value.certainty}」越级提到「${form.toCertainty}」属于跳级，除出处外还须写明理由。`
  }
  if (kind.value === '回档重核') {
    return `由「${pair.value.certainty}」往回调至「${form.toCertainty}」，须写明理由。`
  }
  if (kind.value === '同档补证') {
    return '档位未变，按同档补证处理，须附上本次所依据的出处。'
  }
  return ''
})

const reasonRequired = computed(() => kind.value === '跳级提确' || kind.value === '回档重核')

function errorFor(field: VerificationIssue['field']): string {
  return fieldErrors.value.find((issue) => issue.field === field)?.message ?? ''
}

function resetForm(): void {
  Object.assign(form, createEmptyForm())
  fieldErrors.value = []
  formError.value = ''
}

async function submitVerification(): Promise<void> {
  fieldErrors.value = []
  formError.value = ''
  if (!pair.value) {
    return
  }
  const issues = validateVerification(form, pair.value.certainty)
  if (issues.length) {
    fieldErrors.value = issues
    formError.value = issues.map((issue) => issue.message).join('；')
    return
  }
  try {
    await verificationStore.saveVerification(placePairId.value, { ...form })
  } catch (error) {
    if (error instanceof VerificationRejectedError) {
      fieldErrors.value = error.issues
      formError.value = error.message
      return
    }
    throw error
  }
  resetForm()
  savedFlash.value = true
  window.setTimeout(() => {
    savedFlash.value = false
  }, 2600)
}

function kindTagType(kind: VerificationKind): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (kind === '单级推进' || kind === '初录核证') {
    return 'success'
  }
  if (kind === '跳级提确') {
    return 'warning'
  }
  if (kind === '回档重核') {
    return 'danger'
  }
  return 'info'
}

async function initialize(): Promise<void> {
  await Promise.all([sheetStore.init(), placeStore.init(), verificationStore.init()])
  await placeStore.loadPair(placePairId.value)
  resetForm()
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
        <p>每次确定度变动按时间留一条经过：谁核的、依据哪本书、为何跳级或回档，都写在明处。</p>
      </div>
      <router-link to="/places"><el-button>返回地名对照台</el-button></router-link>
    </div>

    <div class="detail-layout">
      <div>
        <PairRow
          :pair="pair"
          :sheet-code="sheet?.code ?? '图幅待补'"
          :latest-verification="verificationStore.getLatestForPair(pair.id)"
          show-verification
        />

        <div class="section-title">
          <h2>核证经过</h2>
          <span class="muted">共 {{ records.length }} 条 · 最新在前</span>
        </div>

        <div v-if="records.length" class="verify-list">
          <article v-for="record in records" :key="record.id" class="verify-item" data-testid="verify-record">
            <div class="verify-item__head">
              <span class="verify-item__shift">
                {{ record.fromCertainty ?? '建档' }}
                <em aria-hidden="true">→</em>
                <strong>{{ record.toCertainty }}</strong>
              </span>
              <el-tag :type="kindTagType(record.kind)" effect="plain">{{ record.kind }}</el-tag>
              <span class="verify-item__time">{{ formatDateTime(record.changedAt) }}</span>
            </div>
            <dl class="verify-item__facts">
              <div><dt>核证人</dt><dd>{{ record.verifier }}</dd></div>
              <div><dt>依据出处</dt><dd>{{ record.sourceRef || '未填出处' }}</dd></div>
              <div v-if="record.reason"><dt>理由</dt><dd>{{ record.reason }}</dd></div>
            </dl>
          </article>
        </div>
        <div v-else class="empty-inline" data-testid="verify-empty">
          早先录入的对照，尚无核证依据，当前档位「{{ pair.certainty }}」照旧保留。补核后可在此推进档位并留下依据。
        </div>
      </div>

      <aside>
        <form class="inline-form" data-testid="form-verification" @submit.prevent="submitVerification">
          <h2>补核 / 调整档位</h2>
          <p class="verify-current muted">当前档位：<strong>{{ pair.certainty }}</strong></p>
          <el-form-item label="调整后档位" required>
            <select v-model="form.toCertainty" class="native-field" data-testid="field-toCertainty">
              <option v-for="certainty in CERTAINTIES" :key="certainty" :value="certainty">{{ certainty }}</option>
            </select>
          </el-form-item>
          <p v-if="kindHint" class="field-hint">{{ kindHint }}</p>
          <el-form-item label="核证人" required>
            <input v-model="form.verifier" class="native-field" data-testid="field-verifier" placeholder="谁核的" />
          </el-form-item>
          <p v-if="errorFor('verifier')" class="field-hint text-danger" data-testid="error-verifier">{{ errorFor('verifier') }}</p>
          <el-form-item label="依据出处" :required="kind !== '回档重核'">
            <input
              v-model="form.sourceRef"
              class="native-field"
              data-testid="field-sourceRef"
              placeholder="依据哪本书，注明卷页"
            />
          </el-form-item>
          <p v-if="errorFor('sourceRef')" class="field-hint text-danger" data-testid="error-sourceRef">{{ errorFor('sourceRef') }}</p>
          <el-form-item label="理由" :required="reasonRequired">
            <textarea
              v-model="form.reason"
              class="native-field"
              data-testid="field-reason"
              rows="3"
              :placeholder="reasonRequired ? '跳级或往回调必须写明理由' : '可选'"
            ></textarea>
          </el-form-item>
          <p v-if="errorFor('reason')" class="field-hint text-danger" data-testid="error-reason">{{ errorFor('reason') }}</p>
          <p v-if="formError" class="text-danger" data-testid="verify-form-error">{{ formError }}</p>
          <el-button type="primary" native-type="submit" style="width: 100%" data-testid="submit-verification">
            保存核证
          </el-button>
          <p v-if="savedFlash" class="verify-flash" data-testid="verify-saved">核证已留痕，档位已更新。</p>
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
.verify-current {
  margin-bottom: 14px;
  font-size: 13px;
}

.verify-current strong {
  color: var(--accent-dark);
  font-size: 15px;
}

.field-hint {
  margin: -2px 0 10px;
  font-size: 12px;
  line-height: 1.6;
}

.verify-list {
  display: grid;
  gap: 12px;
}

.verify-item {
  padding: 15px 18px;
  background: #fbf7ef;
  border: 1px solid #d5c4b0;
  border-left: 4px solid #8b3f2f;
  border-radius: 7px;
}

.verify-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.verify-item__shift {
  font-size: 14px;
}

.verify-item__shift em {
  margin: 0 5px;
  color: #aa8c72;
  font-style: normal;
}

.verify-item__shift strong {
  color: var(--accent-dark);
  font-size: 16px;
}

.verify-item__time {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}

.verify-item__facts {
  display: grid;
  gap: 6px;
  margin: 11px 0 0;
  font-size: 13px;
}

.verify-item__facts > div {
  display: flex;
  gap: 14px;
}

.verify-item__facts dt {
  flex: 0 0 64px;
  color: var(--muted);
}

.verify-item__facts dd {
  margin: 0;
}

.verify-flash {
  margin-top: 10px;
  color: var(--moss);
  font-size: 12px;
  text-align: center;
}
</style>
