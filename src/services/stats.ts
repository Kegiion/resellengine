export interface PipelineStats {
  scanned: number;
  spamFiltered: number;
  ebayChecked: number;
  profitFiltered: number;
  imageAnalyses: number;
  alarms: number;
}

let stats: PipelineStats = {
  scanned: 0,
  spamFiltered: 0,
  ebayChecked: 0,
  profitFiltered: 0,
  imageAnalyses: 0,
  alarms: 0,
};

export function getStats(): PipelineStats {
  return { ...stats };
}

export function resetStats(): void {
  stats = {
    scanned: 0,
    spamFiltered: 0,
    ebayChecked: 0,
    profitFiltered: 0,
    imageAnalyses: 0,
    alarms: 0,
  };
}

export function incrementScanned(): void {
  stats.scanned += 1;
}

export function incrementSpamFiltered(): void {
  stats.spamFiltered += 1;
}

export function incrementEbayChecked(): void {
  stats.ebayChecked += 1;
}

export function incrementProfitFiltered(): void {
  stats.profitFiltered += 1;
}

export function incrementImageAnalysis(): void {
  stats.imageAnalyses += 1;
}

export function incrementAlarm(): void {
  stats.alarms += 1;
}
