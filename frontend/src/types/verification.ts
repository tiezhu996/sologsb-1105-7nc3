import type { Certainty } from './placePair'

/**
 * 核证留痕：每次确定度变动（含建档首次核录）按时间留一条经过。
 * 早先录入、尚未补核的对照没有对应记录，档位仍以 placePair.certainty 为准。
 */
export interface Verification {
  id: string
  placePairId: string
  /** 变动后的档位 */
  toCertainty: Certainty
  /** 变动前档位；建档首录时为空 */
  fromCertainty: Certainty | null
  /** 依据书目、卷页或档案号；逐级前推与"确定"档位必填 */
  sourceRef: string
  /** 跳级或回调档位的理由；同档补依据时同样在此说明 */
  reason: string
  /** 核证整理者 */
  verifier: string
  /** 核证时间，ISO 字符串 */
  verifiedAt: string
  note: string
}

export type NewVerification = Omit<Verification, 'id'>

/** 档位方向：前推一级为升级，回调为降级，跨两级为跳级，未变则为同级。 */
export type CertaintyMoveKind = '升级' | '降级' | '跳级' | '同级' | '首录'

const CERTAINTY_RANK: Record<Certainty, number> = {
  待考: 0,
  存疑: 1,
  确定: 2,
}

export function certaintyRank(certainty: Certainty): number {
  return CERTAINTY_RANK[certainty]
}

export function classifyCertaintyMove(
  from: Certainty | null,
  to: Certainty,
): CertaintyMoveKind {
  if (from === null) {
    return '首录'
  }
  const distance = certaintyRank(to) - certaintyRank(from)
  if (distance === 0) {
    return '同级'
  }
  if (distance === 1) {
    return '升级'
  }
  if (distance === -1) {
    return '降级'
  }
  return '跳级'
}

/** 人类可读的档位变动描述，如「待考 → 存疑」。 */
export function describeCertaintyMove(from: Certainty | null, to: Certainty): string {
  return from === null ? `建档核录为「${to}」` : `「${from}」改为「${to}」`
}

/**
 * 保存前核证校验。
 * 规则：
 * - 标成「确定」必须填依据；
 * - 逐级前推（待考→存疑、存疑→确定）必须写出处；
 * - 跳级或回调档位必须写明理由（跳级同时需要出处支撑前推性质）。
 * 返回错误文案列表，为空表示可保存。
 */
export function validateVerification(input: {
  from: Certainty | null
  to: Certainty
  sourceRef: string
  reason: string
  verifier: string
}): string[] {
  const errors: string[] = []
  const source = input.sourceRef.trim()
  const reason = input.reason.trim()
  const verifier = input.verifier.trim()
  const kind = classifyCertaintyMove(input.from, input.to)

  if (!verifier) {
    errors.push('缺核证人：请填写本次由谁核证。')
  }

  if (input.to === '确定' && !source) {
    errors.push('缺依据：标为「确定」必须填写所据书目、卷页或档案号。')
  }

  if (kind === '升级' && !source) {
    errors.push('缺出处：档位前推一级（待考→存疑、存疑→确定）须写明出处。')
  }

  if (kind === '跳级') {
    if (!reason) {
      errors.push('缺理由：跨档调整（跳级）须写明理由，不能直接前推两级。')
    }
    if (input.from !== null && certaintyRank(input.to) > certaintyRank(input.from) && !source) {
      errors.push('缺出处：跳级前推仍须提供所据出处。')
    }
  }

  if (kind === '降级' && !reason) {
    errors.push('缺理由：档位回调须写明回调原因（如原依据被否证、发现更早异写等）。')
  }

  if (kind === '同级' && !source && !reason) {
    errors.push('缺内容：补录核证请至少填写依据书目或说明。')
  }

  return errors
}
