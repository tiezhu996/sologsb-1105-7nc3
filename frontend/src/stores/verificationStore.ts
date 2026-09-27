import { ref } from 'vue'
import { defineStore } from 'pinia'
import { usePlaceStore } from './placeStore'
import type {
  VerificationDraft,
  VerificationIssue,
  VerificationRecord,
} from '../types/verification'
import { classifyVerification, validateVerification } from '../types/verification'
import { createId, db, plain } from '../utils/db'

export class VerificationRejectedError extends Error {
  issues: VerificationIssue[]

  constructor(issues: VerificationIssue[]) {
    super(issues.map((issue) => issue.message).join('；'))
    this.name = 'VerificationRejectedError'
    this.issues = issues
  }
}

export const useVerificationStore = defineStore('verification', () => {
  const verifications = ref<VerificationRecord[]>([])
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

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

  /** 按时间正序返回某条对照的核证经过。 */
  function getForPair(placePairId: string): VerificationRecord[] {
    return verifications.value
      .filter((record) => record.placePairId === placePairId)
      .sort((left, right) => left.changedAt.localeCompare(right.changedAt))
  }

  /** 列表用：最近一条核证依据。 */
  function getLatestForPair(placePairId: string): VerificationRecord | undefined {
    const records = getForPair(placePairId)
    return records.length ? records[records.length - 1] : undefined
  }

  function getLatestMap(): Map<string, VerificationRecord> {
    const map = new Map<string, VerificationRecord>()
    for (const record of verifications.value) {
      const existing = map.get(record.placePairId)
      if (!existing || existing.changedAt.localeCompare(record.changedAt) < 0) {
        map.set(record.placePairId, record)
      }
    }
    return map
  }

  /** 初录时附带的核证留痕，由新建对照流程写入。 */
  function attachInitial(record: VerificationRecord): void {
    verifications.value = [...verifications.value, record]
  }

  /**
   * 保存一次核证：
   * 1. 按规则校验，不通过则抛出 VerificationRejectedError，说明缺什么；
   * 2. 与地名对照的档位更新放在同一事务内；
   * 3. 同步内存状态。
   */
  async function saveVerification(
    placePairId: string,
    draft: VerificationDraft,
  ): Promise<VerificationRecord> {
    await init()
    const placeStore = usePlaceStore()
    await placeStore.init()
    const pair = placeStore.getPairById(placePairId)
    if (!pair) {
      throw new VerificationRejectedError([
        { field: 'certainty', message: '未找到对应的地名对照，核证无法保存。' },
      ])
    }

    const issues = validateVerification(draft, pair.certainty)
    if (issues.length) {
      throw new VerificationRejectedError(issues)
    }

    const record: VerificationRecord = {
      id: createId('verif'),
      placePairId,
      fromCertainty: pair.certainty,
      toCertainty: draft.toCertainty,
      kind: classifyVerification(pair.certainty, draft.toCertainty),
      verifier: draft.verifier.trim(),
      sourceRef: draft.sourceRef.trim(),
      reason: draft.reason.trim(),
      changedAt: new Date().toISOString(),
    }

    await db.transaction('rw', db.verifications, db.placePairs, async () => {
      await db.verifications.add(plain(record))
      await db.placePairs.update(placePairId, { certainty: record.toCertainty })
    })
    verifications.value = [...verifications.value, record]
    placeStore.applyCertainty(placePairId, record.toCertainty)
    return record
  }

  return {
    verifications,
    initialized,
    init,
    getForPair,
    getLatestForPair,
    getLatestMap,
    attachInitial,
    saveVerification,
  }
})
