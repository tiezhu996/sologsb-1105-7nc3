import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Certainty } from '../types/placePair'
import type { NewVerification, Verification } from '../types/verification'
import { createId, db, plain } from '../utils/db'

export const useVerificationStore = defineStore('verification', () => {
  const verifications = ref<Verification[]>([])
  const currentPairId = ref('')
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  /** 按时间先后排序的全部留痕，新记录在后。 */
  const sortedVerifications = computed(() =>
    [...verifications.value].sort(
      (left, right) =>
        new Date(left.verifiedAt).getTime() - new Date(right.verifiedAt).getTime(),
    ),
  )

  const currentVerifications = computed(() =>
    sortedVerifications.value.filter((item) => item.placePairId === currentPairId.value),
  )

  async function init(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (!initialization) {
      initialization = db.verifications.toArray().then((rows) => {
        verifications.value = rows
        initialized.value = true
      })
    }
    await initialization
  }

  async function loadFor(placePairId: string): Promise<void> {
    await init()
    currentPairId.value = placePairId
  }

  /** 其他 store 在建档写入首录核证后，调用此方法刷新内存状态。 */
  async function reloadFromDb(): Promise<void> {
    const rows = await db.verifications.toArray()
    verifications.value = rows
  }

  /**
   * 为新建对照补一条首录核证（已在外层事务中，只负责写入当前 store 所管的表）。
   * 返回带 id 的完整记录，供调用方同步内存。
   */
  async function attachInitialRecord(
    input: Omit<NewVerification, 'placePairId' | 'fromCertainty'> & { placePairId: string },
  ): Promise<Verification> {
    const verification: Verification = { ...input, fromCertainty: null, id: createId('verif') }
    await db.verifications.add(plain(verification))
    verifications.value = [...verifications.value, verification]
    return verification
  }

  /**
   * 追加一条核证经过，并同步把地名对照的档位改为新档位。
   * 表单层已先做缺项校验，这里再兜底一次，防止绕过页面直接调用。
   */
  async function addVerification(input: NewVerification): Promise<Verification> {
    await init()
    const verification: Verification = { ...input, id: createId('verif') }
    await db.transaction('rw', db.verifications, db.placePairs, async () => {
      await db.verifications.add(plain(verification))
      await db.placePairs.update(verification.placePairId, {
        certainty: verification.toCertainty,
      })
    })
    verifications.value = [...verifications.value, verification]
    currentPairId.value = verification.placePairId
    return verification
  }

  function getForPair(placePairId: string): Verification[] {
    return sortedVerifications.value.filter((item) => item.placePairId === placePairId)
  }

  function getLatest(placePairId: string): Verification | undefined {
    const rows = getForPair(placePairId)
    return rows[rows.length - 1]
  }

  /** 当前生效档位：以最近一条核证记录为准；旧对照无记录时回落到传入的原档位。 */
  function getCurrentCertainty(
    placePairId: string,
    fallback: Certainty,
  ): Certainty {
    return getLatest(placePairId)?.toCertainty ?? fallback
  }

  function getLatestBasis(placePairId: string): string {
    const latest = getLatest(placePairId)
    if (!latest) {
      return '旧录未补核证'
    }
    return latest.sourceRef.trim() || latest.reason.trim() || '仅补注，未列出处'
  }

  return {
    verifications,
    currentPairId,
    currentVerifications,
    initialized,
    init,
    loadFor,
    reloadFromDb,
    attachInitialRecord,
    addVerification,
    getForPair,
    getLatest,
    getCurrentCertainty,
    getLatestBasis,
  }
})
