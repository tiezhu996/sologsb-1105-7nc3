<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { usePlaceStore, type NewPlacePair } from '../stores/placeStore'
import { useSheetStore } from '../stores/sheetStore'
import { useVerificationStore } from '../stores/verificationStore'
import type { Certainty, PlacePair, PlaceType } from '../types/placePair'
import { CERTAINTIES, PLACE_TYPES } from '../types/placePair'
import { usePlaceSearch } from '../hooks/usePlaceSearch'
import { downloadJson } from '../utils/export'
import PairRow from '../components/common/PairRow.vue'
import VacantHint from '../components/common/VacantHint.vue'

const placeStore = usePlaceStore()
const sheetStore = useSheetStore()
const verificationStore = useVerificationStore()
const { matches } = usePlaceSearch(placeStore.keyword)

const showCreateForm = ref(false)
const formError = ref('')

interface PlaceForm extends NewPlacePair {
  /** 建档时一并补录的核证依据；标为「确定」时必填。 */
  verificationSource: string
  verifier: string
}

function createEmptyForm(): PlaceForm {
  return {
    sheetId: sheetStore.sheets[0]?.id ?? '',
    oldName: '',
    newName: '',
    aliasList: [],
    placeType: '村镇',
    coordNote: '',
    certainty: '确定',
    verificationSource: '',
    verifier: '',
  }
}

const form = reactive<PlaceForm>(createEmptyForm())
const aliasInput = ref('')

const visiblePairs = computed(() =>
  placeStore.filteredPairs.filter((pair) => matches(pair)).sort((left, right) => {
    const sheetCompare = (sheetStore.getSheetById(left.sheetId)?.year ?? 0) - (sheetStore.getSheetById(right.sheetId)?.year ?? 0)
    return sheetCompare || left.oldName.localeCompare(right.oldName, 'zh-CN')
  }),
)

function getSheetCode(pair: PlacePair): string {
  return sheetStore.getSheetById(pair.sheetId)?.code ?? '图幅待补'
}

function getBasis(pair: PlacePair): string {
  return verificationStore.initialized ? verificationStore.getLatestBasis(pair.id) : ''
}

function resetForm(): void {
  Object.assign(form, createEmptyForm())
  aliasInput.value = ''
  formError.value = ''
}

async function submitPlace(): Promise<void> {
  if (!form.sheetId || !form.oldName.trim() || !form.newName.trim()) {
    formError.value = '请选择所属图幅，并填写古名与今名。'
    return
  }
  const verificationSource = form.verificationSource.trim()
  const verifier = form.verifier.trim()
  if (form.certainty === '确定') {
    const missing: string[] = []
    if (!verificationSource) {
      missing.push('依据书目 / 卷页')
    }
    if (!verifier) {
      missing.push('核证人')
    }
    if (missing.length) {
      formError.value = `标为「确定」却填不出依据，保存被拦下：缺 ${missing.join('、')}。如暂无依据，请先把档位降为「存疑」或「待考」。`
      return
    }
  }
  if (verificationSource && !verifier) {
    formError.value = '已填核证依据，还须写明核证人。'
    return
  }

  const pairInput: NewPlacePair = {
    sheetId: form.sheetId,
    oldName: form.oldName.trim(),
    newName: form.newName.trim(),
    aliasList: aliasInput.value
      .split(/[、，,]/)
      .map((alias) => alias.trim())
      .filter(Boolean),
    placeType: form.placeType,
    coordNote: form.coordNote.trim() || '图上方位待核',
    certainty: form.certainty,
  }

  await placeStore.addPair(
    pairInput,
    verificationSource
      ? {
          toCertainty: form.certainty,
          sourceRef: verificationSource,
          reason: '',
          verifier,
          verifiedAt: new Date().toISOString(),
          note: '',
        }
      : undefined,
  )
  resetForm()
  showCreateForm.value = false
}

/** 整份导出：每条地名对照带当前档位、最近依据与完整核证经过（不受当前筛选影响）。 */
function exportVerifications(): void {
  const exportedAt = new Date().toISOString()
  const allPairs = [...placeStore.pairs].sort((left, right) => {
    const sheetCompare =
      (sheetStore.getSheetById(left.sheetId)?.year ?? 0) -
      (sheetStore.getSheetById(right.sheetId)?.year ?? 0)
    return sheetCompare || left.oldName.localeCompare(right.oldName, 'zh-CN')
  })
  const entries = allPairs.map((pair) => {
    const records = verificationStore.getForPair(pair.id)
    return {
      id: pair.id,
      sheetCode: getSheetCode(pair),
      oldName: pair.oldName,
      newName: pair.newName,
      placeType: pair.placeType,
      currentCertainty: pair.certainty,
      latestBasis: verificationStore.getLatestBasis(pair.id),
      verificationCount: records.length,
      verifications: records.map((record) => ({
        fromCertainty: record.fromCertainty,
        toCertainty: record.toCertainty,
        sourceRef: record.sourceRef,
        reason: record.reason,
        verifier: record.verifier,
        verifiedAt: record.verifiedAt,
        note: record.note,
      })),
    }
  })
  downloadJson(`地名核证全档-${exportedAt.slice(0, 10)}.json`, {
    exportedAt,
    total: entries.length,
    entries,
  })
}

async function initialize(): Promise<void> {
  await Promise.all([sheetStore.init(), placeStore.init(), verificationStore.init()])
  if (!form.sheetId) {
    form.sheetId = sheetStore.sheets[0]?.id ?? ''
  }
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <section class="page">
    <div class="page-heading">
      <div>
        <span class="page-kicker">GAZETTEER CROSS-REFERENCE</span>
        <h1>地名对照台</h1>
        <p>并置古地图旧名与现代地名，收录异写异读、图上方位和核证程度；确定度调整须留依据与经过，供地名反向查询与交叉复核。</p>
      </div>
      <div class="page-heading__actions">
        <el-button size="large" data-testid="export-verifications" @click="exportVerifications">
          导出核证全档
        </el-button>
        <el-button type="primary" size="large" data-testid="new-place" @click="showCreateForm = true">
          新建地名对照
        </el-button>
      </div>
    </div>

    <form v-if="showCreateForm" class="inline-form" data-testid="form-place" @submit.prevent="submitPlace">
      <h2>新建古今地名对照</h2>
      <div class="form-grid">
        <el-form-item label="所属图幅" required>
          <select v-model="form.sheetId" class="native-field" data-testid="field-sheetId">
            <option v-for="sheet in sheetStore.sheets" :key="sheet.id" :value="sheet.id">
              {{ sheet.code }} · {{ sheet.title }}
            </option>
          </select>
        </el-form-item>
        <el-form-item label="图上旧名" required>
          <input v-model="form.oldName" class="native-field" data-testid="field-oldName" />
        </el-form-item>
        <el-form-item label="今地名" required>
          <input v-model="form.newName" class="native-field" data-testid="field-newName" />
        </el-form-item>
        <el-form-item label="地名类型" required>
          <select v-model="form.placeType" class="native-field" data-testid="field-placeType">
            <option v-for="placeType in PLACE_TYPES" :key="placeType" :value="placeType">{{ placeType }}</option>
          </select>
        </el-form-item>
        <el-form-item label="确定度" required>
          <select v-model="form.certainty" class="native-field" data-testid="field-certainty">
            <option v-for="certainty in CERTAINTIES" :key="certainty" :value="certainty">{{ certainty }}</option>
          </select>
        </el-form-item>
        <el-form-item label="异写异读">
          <input v-model="aliasInput" class="native-field" data-testid="field-aliasList" placeholder="多个异写用逗号分隔" />
        </el-form-item>
        <el-form-item label="核证依据 · 卷页" :required="form.certainty === '确定'">
          <input
            v-model="form.verificationSource"
            class="native-field"
            data-testid="field-verificationSource"
            :placeholder="form.certainty === '确定' ? '标为确定必须填写所据书目' : '建档即有依据时填写（可后补）'"
          />
        </el-form-item>
        <el-form-item label="核证人" :required="form.certainty === '确定'">
          <input v-model="form.verifier" class="native-field" data-testid="field-verifier" placeholder="本次由谁核证" />
        </el-form-item>
        <el-form-item label="图上方位" required class="form-grid__wide">
          <textarea v-model="form.coordNote" class="native-field" data-testid="field-coordNote" rows="3"></textarea>
        </el-form-item>
        <p v-if="form.certainty === '确定'" class="form-grid__wide create-verification-hint">
          标为「确定」必须同时填写核证依据与核证人，缺项保存会被拦下；暂无依据请先选「存疑」或「待考」。
        </p>
        <div class="form-actions">
          <el-button @click="showCreateForm = false; resetForm()">取消</el-button>
          <el-button type="primary" native-type="submit" data-testid="submit-place">保存对照</el-button>
        </div>
      </div>
      <p v-if="formError" class="text-danger" data-testid="place-form-error">{{ formError }}</p>
    </form>

    <div class="filter-bar">
      <el-input v-model="placeStore.keyword" clearable placeholder="输入古名、今名、异写或图上方位，反向查询" class="filter-bar__grow" />
      <el-select v-model="placeStore.placeTypeFilter" style="width: 130px" aria-label="按地名类型筛选">
        <el-option label="全部类型" value="全部" />
        <el-option v-for="placeType in PLACE_TYPES" :key="placeType" :label="placeType" :value="placeType" />
      </el-select>
      <el-select v-model="placeStore.certaintyFilter" style="width: 130px" aria-label="按确定度筛选">
        <el-option label="全部确定度" value="全部" />
        <el-option v-for="certainty in CERTAINTIES" :key="certainty" :label="certainty" :value="certainty" />
      </el-select>
      <span class="filter-count">当前记录数：<strong data-testid="count-place">{{ visiblePairs.length }}</strong></span>
    </div>

    <div v-if="visiblePairs.length" class="place-list">
      <div v-for="pair in visiblePairs" :key="pair.id" data-testid="row-place">
        <PairRow
          :pair="pair"
          :query="placeStore.keyword"
          :sheet-code="getSheetCode(pair)"
          :basis="getBasis(pair)"
        />
        <div class="pair-row-actions">
          <router-link :to="`/places/${pair.id}/history`">
            <el-button link type="primary">展开沿革时间线</el-button>
          </router-link>
          <router-link :to="`/places/${pair.id}/verification`">
            <el-button link type="primary" data-testid="open-verification">核证留痕</el-button>
          </router-link>
        </div>
      </div>
    </div>

    <VacantHint
      v-else
      title="没有命中的地名记录"
      description="换用古名、今名、异写或图上方位中的任意关键词，或者新建一条地名对照。"
      action-text="新建地名对照"
      @action="showCreateForm = true"
    />
  </section>
</template>

<style scoped>
.form-grid__wide {
  grid-column: span 2;
}

.page-heading__actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.create-verification-hint {
  margin: -4px 0 12px;
  padding: 9px 12px;
  color: #7a5a48;
  background: #f0e6d6;
  border-left: 3px solid #a65d48;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.7;
}

.pair-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  padding: 5px 12px 0;
}

@media (max-width: 680px) {
  .form-grid__wide {
    grid-column: auto;
  }

  .page-heading__actions {
    flex-direction: column;
  }
}
</style>
