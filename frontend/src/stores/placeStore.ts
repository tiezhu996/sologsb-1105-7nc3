import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Certainty, PlacePair, PlaceType } from '../types/placePair'
import type { NewVerification } from '../types/verification'
import { createId, db, plain } from '../utils/db'
import { useVerificationStore } from './verificationStore'

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
   * 新建地名对照。
   * 若建档即填依据（尤其直接标为「确定」时），在同一事务写入首录核证留痕。
   */
  async function addPair(
    input: NewPlacePair,
    initialVerification?: Omit<NewVerification, 'placePairId' | 'fromCertainty'>,
  ): Promise<PlacePair> {
    await init()
    const pair: PlacePair = { ...input, id: createId('place') }
    const verificationStore = useVerificationStore()
    await db.transaction('rw', db.placePairs, db.verifications, async () => {
      await db.placePairs.add(plain(pair))
      if (initialVerification) {
        await verificationStore.attachInitialRecord({
          ...initialVerification,
          placePairId: pair.id,
        })
      }
    })
    pairs.value = [...pairs.value, pair]
    currentPair.value = pair
    return pair
  }

  async function loadPair(id: string): Promise<void> {
    await init()
    currentPair.value = pairs.value.find((pair) => pair.id === id) ?? (await db.placePairs.get(id)) ?? null
  }

  function getPairsForSheet(sheetId: string): PlacePair[] {
    return pairs.value.filter((pair) => pair.sheetId === sheetId)
  }

  function setMatchedPairIds(ids: string[]): void {
    matchedPairIds.value = [...ids]
  }

  /** 核证保存后同步内存中的当前档位（数据库更新由核证流程在同一事务完成）。 */
  function updateCertainty(id: string, certainty: Certainty): void {
    pairs.value = pairs.value.map((pair) => (pair.id === id ? { ...pair, certainty } : pair))
    if (currentPair.value?.id === id) {
      currentPair.value = { ...currentPair.value, certainty }
    }
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
    getPairsForSheet,
    setMatchedPairIds,
    updateCertainty,
    resetFilters,
  }
})
