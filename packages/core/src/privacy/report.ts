/**
 * Pre-transfer redaction report.
 *
 * ST3: Shows what was detected, what action was taken,
 * and warns about remaining risks before transfer.
 */

import type { RedactedEvent, RedactionSummary } from './redactor';
import { RedactionActions } from './redactor';
import type { SecretDetection } from './patterns';

export interface RedactionReport {
  generatedAt: string;
  summary: RedactionSummary;
  detections: RedactionReportEntry[];
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  transferSafe: boolean;
  recommendations: string[];
}

export interface RedactionReportEntry {
  eventId: string;
  eventType: string;
  action: string;
  detections: Array<{
    label: string;
    type: string;
    maskedMatch: string;
    highFalsePositive: boolean;
  }>;
}

export function buildRedactionReport(
  processed: RedactedEvent[],
  summary: RedactionSummary,
): RedactionReport {
  const detections: RedactionReportEntry[] = [];

  for (const item of processed) {
    if (item.detectionsFound.length === 0) continue;

    detections.push({
      eventId: item.event.id,
      eventType: item.event.type,
      action: item.action,
      detections: item.detectionsFound.map((d) => ({
        label: d.label,
        type: d.type,
        maskedMatch: d.maskedMatch,
        highFalsePositive: d.highFalsePositive,
      })),
    });
  }

  // Risk assessment
  const hasPrivateKeys = summary.detectionsByType['private_key'] > 0;
  const hasAWSCreds = summary.detectionsByType['aws_credential'] > 0;
  const hasConnStrings = summary.detectionsByType['connection_string'] > 0;
  const hasExcluded = summary.excludedEvents > 0;
  const hasReferenced = summary.referencedEvents > 0;

  let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';

  if (summary.totalDetections === 0) {
    riskLevel = 'none';
  } else if (hasPrivateKeys || hasAWSCreds || hasConnStrings) {
    riskLevel = hasExcluded || hasReferenced || summary.redactedEvents > 0 ? 'medium' : 'high';
  } else if (summary.totalDetections > 5) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Transfer safety
  const unresolvedHighRisk = processed.some(
    (p) => p.action !== RedactionActions.EXCLUDE &&
           p.action !== RedactionActions.REFERENCE &&
           p.detectionsFound.some((d) => d.type === 'private_key' || d.type === 'aws_credential'),
  );

  const transferSafe = !unresolvedHighRisk && riskLevel !== 'high';

  // Recommendations
  const recommendations: string[] = [];

  if (summary.totalDetections === 0) {
    recommendations.push('No secrets detected. Safe to transfer.');
  }

  if (hasPrivateKeys) {
    recommendations.push('Private keys were detected. Verify they are fully redacted before transfer.');
  }

  if (hasAWSCreds) {
    recommendations.push('AWS credentials were detected. Rotate these keys immediately if they were ever shared.');
  }

  if (hasConnStrings) {
    recommendations.push('Database connection strings with credentials detected. Consider rotating passwords.');
  }

  if (summary.excludedEvents > 0) {
    recommendations.push(`${summary.excludedEvents} event(s) were excluded from transfer. The receiving agent will not see these.`);
  }

  if (summary.referencedEvents > 0) {
    recommendations.push(`${summary.referencedEvents} event(s) were replaced with references. Content was removed but the event ID is preserved.`);
  }

  const fpCount = processed.reduce(
    (sum, p) => sum + p.detectionsFound.filter((d) => d.highFalsePositive).length,
    0,
  );

  if (fpCount > 0) {
    recommendations.push(`${fpCount} detection(s) may be false positives. Review with --verbose before transfer.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    detections,
    riskLevel,
    transferSafe,
    recommendations,
  };
}
