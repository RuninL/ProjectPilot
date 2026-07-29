import type { RiskImpact, RiskLevel, RiskLikelihood } from '@/types';

/** The single risk-level rule used for UI preview and every persisted write. */
export function calculateRiskLevel(likelihood: RiskLikelihood, impact: RiskImpact): RiskLevel {
  if (likelihood === 'high' && impact === 'high') {
    return 'critical';
  }
  if (
    (likelihood === 'high' && impact === 'medium') ||
    (impact === 'high' && likelihood === 'medium')
  ) {
    return 'high';
  }
  return likelihood === 'medium' && impact === 'medium' ? 'medium' : 'low';
}

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
