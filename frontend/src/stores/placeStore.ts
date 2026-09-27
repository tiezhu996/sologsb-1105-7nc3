import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Certainty, PlacePair, PlaceType } from '../types/placePair'
import type { NewVerificationRecord, VerificationRecord } from '../types/verification'
import { createId, db, plain } from '../utils/db'

export type NewPlacePair = Omit<PlacePair, 'id'>

export const usePlaceStore = defineStore('place', () => {
  const pairs = ref<PlacePair[]>([])
  const currentPair = ref<PlacePair | null>(null)
  const placeTypeFilter = ref<PlaceType | '全部'>('全部')
  const certaintyFilter = ref<Certainty | '全部'>('全部')
  const keyword = ref('')
  const matchedPairIds = ref<string[]>([])
  const initialized = ref(false)
  let initialization: Promise<void> | null = null

  const filteredPairs = computed(() =>
    pairs.value.filter((pair) => {
      const matchesType = placeTypeFilter.value === '全部' || pair.placeType === placeTypeFilter.value
      const matchesCertainty =
        certaintyFilter.value === '全部' || pair.certainty === certaintyFilter.value
      return matchesType && matchesCertainty
    }),
  )

  async function init(): Promise<void> {
    if (initialized.value) {
      return
    }
    if (!initialization) {
      initialization = db.placePairs.toArray().then((rows) => {
        pairs.value = rows
        initialized.value = true
      })
    }
    await initialization
  }

  /**
   * 新建对照。若附带初录核证（核证人/依据），则与首条核证留痕
   * 在同一事务内落库；不附带时按早先流程直接建档。
   */
  async function addPair(
    input: NewPlacePair,
    initialVerification?: Omit<NewVerificationRecord, 'placePairId' | 'fromCertainty' | 'kind'>,
  ): Promise<{ pair: PlacePair; verification?: VerificationRecord }> {
    await init()
    const pair: PlacePair = { ...input, id: createId('place') }
    let verification: VerificationRecord | undefined
    if (initialVerification) {
      verification = {
        ...initialVerification,
        id: createId('verif'),
        placePairId: pair.id,
        fromCertainty: null,
        kind: '初录核证',
      }
    }
    await db.transaction('rw', db.placePairs, db.verifications, async () => {
      await db.placePairs.add(plain(pair))
      if (verification) {
        await db.verifications.add(plain(verification))
      }
    })
    pairs.value = [...pairs.value, pair]
    currentPair.value = pair
    return { pair, verification }
  }

  async function loadPair(id: string): Promise<void> {
    await init()
    currentPair.value = pairs.value.find((pair) => pair.id === id) ?? (await db.placePairs.get(id)) ?? null
  }

  /** 核证保存成功后，同步内存中的确定度档位。 */
  function applyCertainty(pairId: string, certainty: Certainty): void {
    pairs.value = pairs.value.map((pair) => (pair.id === pairId ? { ...pair, certainty } : pair))
    if (currentPair.value?.id === pairId) {
      currentPair.value = { ...currentPair.value, certainty }
    }
  }

  function getPairsForSheet(sheetId: string): PlacePair[] {
    return pairs.value.filter((pair) => pair.sheetId === sheetId)
  }

  function getPairById(pairId: string): PlacePair | undefined {
    return pairs.value.find((pair) => pair.id === pairId)
  }

  function setMatchedPairIds(ids: string[]): void {
    matchedPairIds.value = [...ids]
  }

  function resetFilters(): void {
    placeTypeFilter.value = '全部'
    certaintyFilter.value = '全部'
    keyword.value = ''
    matchedPairIds.value = []
  }

  return {
    pairs,
    currentPair,
    placeTypeFilter,
    certaintyFilter,
    keyword,
    matchedPairIds,
    filteredPairs,
    initialized,
    init,
    addPair,
    loadPair,
    applyCertainty,
    getPairsForSheet,
    getPairById,
    setMatchedPairIds,
    resetFilters,
  }
})
