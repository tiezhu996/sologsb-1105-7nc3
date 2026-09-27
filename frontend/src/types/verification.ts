import type { Certainty } from './placePair'

/** 核证档位顺序：数值越大越确定。 */
export const CERTAINTY_RANK: Record<Certainty, number> = {
  待考: 0,
  存疑: 1,
  确定: 2,
}

/** 核证变动类型 */
export type VerificationKind = '初录核证' | '单级推进' | '跳级提确' | '回档重核' | '同档补证'

/** 一条核证留痕 */
export interface VerificationRecord {
  id: string
  placePairId: string
  /** 变动前档位；初录核证时为 null */
  fromCertainty: Certainty | null
  /** 变动后档位 */
  toCertainty: Certainty
  /** 变动类型，落库后不再依赖档位推算 */
  kind: VerificationKind
  /** 核证人 */
  verifier: string
  /** 依据（志书、档案、卷页等）；档位推进或维持确定时必填 */
  sourceRef: string
  /** 理由（跳级、往回调时必填，同档补证可选） */
  reason: string
  /** ISO 时间戳 */
  changedAt: string
}

export type NewVerificationRecord = Omit<VerificationRecord, 'id'>

export interface VerificationDraft {
  toCertainty: Certainty
  verifier: string
  sourceRef: string
  reason: string
}

/** 判断变动类型。from 为 null 表示初录核证。 */
export function classifyVerification(
  from: Certainty | null,
  to: Certainty,
): VerificationKind {
  if (from === null) {
    return '初录核证'
  }
  const diff = CERTAINTY_RANK[to] - CERTAINTY_RANK[from]
  if (diff === 0) {
    return '同档补证'
  }
  if (diff === 1) {
    return '单级推进'
  }
  if (diff > 1) {
    return '跳级提确'
  }
  return '回档重核'
}

export interface VerificationIssue {
  field: 'verifier' | 'sourceRef' | 'reason' | 'certainty'
  message: string
}

/**
 * 校验核证草稿：
 * - 初录定「确定」或在核证页做任何变动，都必须有核证人；
 * - 目标档位为「确定」时必须填依据（定档必须有据）；
 * - 单级推进、同档补证须写出处；
 * - 跳级或往回调须写明理由。
 * 初录即定存疑、待考可暂不填核证人与依据（与旧录数据一致）。
 */
export function validateVerification(
  draft: VerificationDraft,
  from: Certainty | null,
): VerificationIssue[] {
  const issues: VerificationIssue[] = []
  const kind = classifyVerification(from, draft.toCertainty)
  const verifier = draft.verifier.trim()
  const sourceRef = draft.sourceRef.trim()
  const reason = draft.reason.trim()

  // 初录时定为「确定」须当场留下完整核证；存疑、待考可先建档后补核。
  // 一旦在核证页做任何变动，核证人均必填。
  const verifierRequired = from !== null || draft.toCertainty === '确定'
  if (verifierRequired && !verifier) {
    issues.push({
      field: 'verifier',
      message:
        from === null
          ? '定为「确定」必须填写核证人，注明谁核的。'
          : '请填写核证人，注明谁核的。',
    })
  }

  if (!sourceRef) {
    if (draft.toCertainty === '确定') {
      issues.push({
        field: 'sourceRef',
        message: '定为「确定」必须填写依据：志书、档案或图幅信息及卷页。',
      })
    } else if (kind === '单级推进') {
      issues.push({
        field: 'sourceRef',
        message: `由「${from}」推进至「${draft.toCertainty}」须写出处，注明依据哪本书、哪一卷页。`,
      })
    } else if (kind === '同档补证') {
      issues.push({
        field: 'sourceRef',
        message: '同档补证须附上本次所依据的出处。',
      })
    }
  }

  if (!reason && (kind === '跳级提确' || kind === '回档重核')) {
    if (kind === '跳级提确') {
      issues.push({
        field: 'reason',
        message: `从「${from}」越级提到「${draft.toCertainty}」属于跳级，须写明理由。`,
      })
    } else {
      issues.push({
        field: 'reason',
        message: `由「${from}」回调至「${draft.toCertainty}」属于往回调，须写明理由。`,
      })
    }
  }

  return issues
}

/** 返回建议的下一档位（往前推一级）；已是「确定」则保持。 */
export function nextCertainty(current: Certainty): Certainty {
  if (current === '待考') {
    return '存疑'
  }
  if (current === '存疑') {
    return '确定'
  }
  return '确定'
}
